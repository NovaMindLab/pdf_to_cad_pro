import os
import sys
import json
import argparse
import math
import pdfplumber
import ezdxf

def dist(p1, p2):
    return math.hypot(p1[0]-p2[0], p1[1]-p2[1])

def get_midpoint(p1, p2):
    return ((p1[0]+p2[0])/2.0, (p1[1]+p2[1])/2.0)

def is_chinese_char(c):
    return '\u4e00' <= c <= '\u9fff'

def char_is_rotated(obj):
    """
    Detect rotated/oblique text by the shear components of its matrix.
    pdfplumber's `upright` only catches 90-degree rotations (vertical CJK),
    but CAD drawings also contain labels rotated at arbitrary angles (e.g.
    59deg / -47deg fibre labels running along slanted cables). Those have
    non-zero matrix[1]/matrix[2]. Relying on `upright` alone lets them fall
    through to horizontal grouping, where they get merged with wrong width
    factors and overlap neighbours -> ghost text.
    """
    if obj.get('object_type') != 'char':
        return False
    m = obj.get('matrix')
    if not m or len(m) < 4:
        return False
    # pdfplumber matrix = (a, b, c, d, e, f). The shear/rotation components are
    # b (matrix[1]) and c (matrix[2]); d (matrix[3]) is vertical scale, which is
    # non-zero for every normal upright char. Checking matrix[3] would therefore
    # flag every character as rotated.
    return abs(m[1]) > 1e-3 or abs(m[2]) > 1e-3

# AutoCAD Standard ACI Color Palette
ACI_PALETTE = {
    1: (255, 0, 0),       # Red
    2: (255, 255, 0),     # Yellow
    3: (0, 255, 0),       # Green
    4: (0, 255, 255),     # Cyan
    5: (0, 0, 255),       # Blue
    6: (255, 0, 255),     # Magenta
    7: (255, 255, 255),   # White/Black
    8: (128, 128, 128),   # Dark Gray
    9: (192, 192, 192),   # Light Gray
}

def rgb_to_aci(r, g, b):
    if r > 220 and g > 220 and b > 220:
        return 7
    if r < 35 and g < 35 and b < 35:
        return 7
    best_aci = 7
    best_dist = float('inf')
    for aci, (pr, pg, pb) in ACI_PALETTE.items():
        d = (r - pr)**2 + (g - pg)**2 + (b - pb)**2
        if d < best_dist:
            best_dist = d
            best_aci = aci
    return best_aci

def parse_pdf_color(raw_color):
    """
    Parses pdfplumber color (RGB, CMYK, Gray) to RGB tuple (0-255) and AutoCAD ACI color.
    """
    if raw_color is None:
        return (255, 255, 255), 7
    if isinstance(raw_color, (int, float)):
        v = int(max(0, min(1, raw_color)) * 255)
        return (v, v, v), (7 if v > 128 else 7)
    if isinstance(raw_color, (list, tuple)):
        if len(raw_color) == 1:
            v = int(max(0, min(1, raw_color[0])) * 255)
            return (v, v, v), (7 if v > 128 else 7)
        elif len(raw_color) == 3:
            r, g, b = [int(c * 255 if isinstance(c, float) and c <= 1.0 else c) for c in raw_color]
            r = max(0, min(255, r))
            g = max(0, min(255, g))
            b = max(0, min(255, b))
            return (r, g, b), rgb_to_aci(r, g, b)
        elif len(raw_color) == 4:
            c, m, y, k = [float(x) for x in raw_color]
            r = int(255 * (1 - c) * (1 - k))
            g = int(255 * (1 - m) * (1 - k))
            b = int(255 * (1 - y) * (1 - k))
            r = max(0, min(255, r))
            g = max(0, min(255, g))
            b = max(0, min(255, b))
            return (r, g, b), rgb_to_aci(r, g, b)
    return (255, 255, 255), 7

def fit_circle(pts):
    """
    Detects if pts (from closed curve / bezier) form a circle.
    Returns (cx, cy, radius) if fit is tight, else None.
    """
    if len(pts) < 6:
        return None
    if dist(pts[0], pts[-1]) > 3.0:
        return None
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    radii = [math.hypot(p[0] - cx, p[1] - cy) for p in pts]
    r_avg = sum(radii) / len(radii)
    if r_avg < 1.0 or r_avg > 800.0:
        return None
    max_dev = max(abs(r - r_avg) for r in radii)
    if max_dev / r_avg < 0.08:
        return (cx, cy, r_avg)
    return None

def fit_arc(pts, page_h):
    """
    Detects if pts form a circular arc.
    Returns (cx, cy, radius, start_angle_cad, end_angle_cad) or None.
    """
    if len(pts) < 5:
        return None
    if dist(pts[0], pts[-1]) < 3.0:
        return None
    p0 = pts[0]
    p1 = pts[len(pts) // 2]
    p2 = pts[-1]
    d = 2 * (p0[0] * (p1[1] - p2[1]) + p1[0] * (p2[1] - p0[1]) + p2[0] * (p0[1] - p1[1]))
    if abs(d) < 1e-5:
        return None
    cx = ((p0[0]**2 + p0[1]**2) * (p1[1] - p2[1]) + (p1[0]**2 + p1[1]**2) * (p2[1] - p0[1]) + (p2[0]**2 + p2[0]**2) * (p0[1] - p1[1])) / d
    cy = ((p0[0]**2 + p0[1]**2) * (p2[0] - p1[0]) + (p1[0]**2 + p1[1]**2) * (p0[0] - p2[0]) + (p2[0]**2 + p2[0]**2) * (p1[0] - p0[0])) / d
    r_avg = math.hypot(p0[0] - cx, p0[1] - cy)
    if r_avg < 2.0 or r_avg > 1000.0:
        return None
    radii = [math.hypot(p[0] - cx, p[1] - cy) for p in pts]
    max_dev = max(abs(r - r_avg) for r in radii)
    if max_dev / r_avg > 0.08:
        return None
    ang0 = math.degrees(math.atan2((page_h - p0[1]) - (page_h - cy), p0[0] - cx)) % 360
    ang2 = math.degrees(math.atan2((page_h - p2[1]) - (page_h - cy), p2[0] - cx)) % 360
    ang1 = math.degrees(math.atan2((page_h - p1[1]) - (page_h - cy), p1[0] - cx)) % 360
    def is_between_ccw(start, mid, end):
        if start < end:
            return start <= mid <= end
        return mid >= start or mid <= end
    if is_between_ccw(ang0, ang1, ang2):
        start_deg, end_deg = ang0, ang2
    else:
        start_deg, end_deg = ang2, ang0
    return (cx, cy, r_avg, start_deg, end_deg)

def group_rotated_chars_into_words(chars):
    """
    Groups adjacent characters that share a similar rotation angle into readable text lines.
    """
    if not chars:
        return []
    clean = []
    for c in chars:
        m = c.get('matrix')
        if not m:
            continue
        rad = math.atan2(m[1], m[0])
        deg = round(math.degrees(rad), 1)
        cad_deg = round((-deg) % 360, 1)
        c['_cad_angle'] = cad_deg
        c['_angle_rad'] = rad
        clean.append(c)
    clean.sort(key=lambda c: (round(c['_cad_angle'], 0), c['top'], c['x0']))
    words = []
    current_word = []
    for c in clean:
        if not c.get('text') or not c['text'].strip():
            continue
        if not current_word:
            current_word.append(c)
            continue
        prev = current_word[-1]
        angle_diff = abs(c['_cad_angle'] - prev['_cad_angle'])
        if angle_diff > 180:
            angle_diff = 360 - angle_diff
        char_dist = dist((prev['x0'], prev['top']), (c['x0'], c['top']))
        h = max(prev.get('size', 10), c.get('size', 10))
        if angle_diff <= 2.0 and char_dist < h * 2.0:
            current_word.append(c)
        else:
            words.append(current_word)
            current_word = [c]
    if current_word:
        words.append(current_word)
    result = []
    for cw in words:
        text = "".join(c['text'] for c in cw)
        first = cw[0]
        size = first.get('size', first['bottom'] - first['top'])
        angle = first['_cad_angle']
        result.append({
            'text': text,
            'x0': first['x0'],
            'y0': first['top'],
            'bottom': first['bottom'],
            'size': size,
            'rotation': angle,
            'color': first.get('non_stroking_color')
        })
    return result

def dedup_words(words):
    """
    Removes duplicate words caused by PDF double-drawing (fake bold / shadow layers):
    same text with strongly overlapping bounding boxes => keep only one copy.
    """
    result = []
    for w in sorted(words, key=lambda w: (w['top'], w['x0'])):
        dup = False
        # Only compare against recently kept words (words are sorted, far ones can't overlap)
        for s in result[-60:]:
            if s['text'] != w['text']:
                continue
            ox = min(s['x1'], w['x1']) - max(s['x0'], w['x0'])
            oy = min(s['bottom'], w['bottom']) - max(s['top'], w['top'])
            if ox > 0 and oy > 0:
                a1 = (s['x1'] - s['x0']) * (s['bottom'] - s['top'])
                a2 = (w['x1'] - w['x0']) * (w['bottom'] - w['top'])
                if (ox * oy) > 0.5 * min(a1, a2):
                    dup = True
                    break
        if not dup:
            result.append(w)
    return result


class SpatialWordIndex:
    """
    Fast 2D grid spatial index for detecting whether small vector strokes/curves
    are actually SHX font character strokes that duplicate the PDF's text layer.
    """
    def __init__(self, words, cell_size=60.0):
        self.cell_size = cell_size
        self.grid = {}
        for w in words:
            # Word bounding box with a slight 1.0pt tolerance margin
            wx0 = w['x0'] - 1.0
            wx1 = w['x1'] + 1.0
            wy0 = w['top'] - 1.0
            wy1 = w['bottom'] + 1.0
            w_box = (wx0, wy0, wx1, wy1)
            gx0 = int(wx0 // cell_size)
            gx1 = int(wx1 // cell_size)
            gy0 = int(wy0 // cell_size)
            gy1 = int(wy1 // cell_size)
            for gx in range(gx0, gx1 + 1):
                for gy in range(gy0, gy1 + 1):
                    self.grid.setdefault((gx, gy), []).append(w_box)

    def is_inside_text(self, bx0, by0, bx1, by1, max_stroke_size=35.0):
        # Real drawing lines (borders, cables, buses, frames) are longer than 35pt
        if (bx1 - bx0) > max_stroke_size or (by1 - by0) > max_stroke_size:
            return False
        gx = int(bx0 // self.cell_size)
        gy = int(by0 // self.cell_size)
        candidates = self.grid.get((gx, gy))
        if not candidates:
            return False
        for wx0, wy0, wx1, wy1 in candidates:
            if bx0 >= wx0 and bx1 <= wx1 and by0 >= wy0 and by1 <= wy1:
                return True
        return False


def natural_text_width(text, size):
    """Estimated natural width: CJK=1em, ASCII=0.6em, space=0.3em."""
    w = 0.0
    for ch in text:
        if ch == ' ':
            w += size * 0.3
        elif ord(ch) > 0x2E80:
            w += size
        else:
            w += size * 0.6
    return w


def group_words_into_lines(words, tolerance=3.0):
    """
    Groups pdfplumber word dictionaries into cohesive text lines based on vertical baseline alignment
    and horizontal proximity.
    """
    if not words:
        return []

    # --- 1. Deduplicate double-drawn words (fake bold / shadow) to avoid overlapping text ---
    words = dedup_words(words)

    # --- 2. Group words into lines by vertical span overlap (handles mixed sizes / sub-superscripts) ---
    lines = []
    # Sort primarily by vertical top coordinate, secondarily by horizontal x0
    sorted_words = sorted(words, key=lambda w: (w['top'], w['x0']))

    for word in sorted_words:
        word_h = word['bottom'] - word['top']
        placed = False
        best_line = None
        best_dist = None
        for line in lines:
            line_top = min(w['top'] for w in line)
            line_bottom = max(w['bottom'] for w in line)
            line_h = line_bottom - line_top
            # Vertical overlap between the word and the line
            ov = min(word['bottom'], line_bottom) - max(word['top'], line_top)
            if ov > 0.4 * min(word_h, line_h):
                # Horizontal distance to the nearest word of this line
                dist = min(min(abs(word['x0'] - w2['x1']), abs(w2['x0'] - word['x1']))
                           for w2 in line)
                if dist < word_h * 2.5 and (best_dist is None or dist < best_dist):
                    best_dist = dist
                    best_line = line
        if best_line is not None:
            best_line.append(word)
            placed = True
        if not placed:
            lines.append([word])
        
    # Process each horizontal line group: sort left-to-right and merge words
    merged_lines = []
    for line in lines:
        sorted_line = sorted(line, key=lambda w: w['x0'])
        
        # Merge words that are close horizontally.
        # If there's a large gap between adjacent words (e.g. columns or tables),
        # treat them as separate text entities in CAD.
        parts = [sorted_line[0]]
        x0 = sorted_line[0]['x0']
        x1 = sorted_line[0]['x1']
        top = sorted_line[0]['top']
        bottom = sorted_line[0]['bottom']
        font_name = sorted_line[0].get('fontname', 'Standard')
        font_size = sorted_line[0].get('size', bottom - top)

        merged_text = sorted_line[0]['text']
        
        for p in sorted_line[1:]:
            gap = p['x0'] - parts[-1]['x1']
            current_char_height = p['bottom'] - p['top']

            # --- Check compression-ratio compatibility ---
            p_size = p.get('size', current_char_height) or current_char_height
            p_natural = natural_text_width(p['text'], p_size)
            p_ratio = (p['x1'] - p['x0']) / p_natural if p_natural > 1e-3 else 1.0
            cur_natural = natural_text_width(merged_text, font_size)
            cur_ratio = (x1 - x0) / cur_natural if cur_natural > 1e-3 else 1.0
            ratio_mismatch = (
                p_natural > 1e-3 and cur_natural > 1e-3
                and abs(p_ratio - cur_ratio) > 0.25 * max(p_ratio, cur_ratio)
            )

            # In CAD drawings, table columns / cell numbers (like 44P, 45P, 46P)
            # have gaps > 0.35 * height or > 4.0pt. Merging them into a single TEXT
            # causes horizontal drift and overlap with cell borders / adjacent labels.
            max_merge_gap = min(current_char_height * 0.35, 4.0)
            if gap > max_merge_gap or ratio_mismatch:
                merged_lines.append({
                    'text': merged_text,
                    'x0': x0,
                    'x1': x1,
                    'top': top,
                    'bottom': bottom,
                    'size': font_size,
                    'fontname': font_name
                })
                # Reset for new text entity
                parts = [p]
                x0 = p['x0']
                x1 = p['x1']
                top = p['top']
                bottom = p['bottom']
                font_name = p.get('fontname', 'Standard')
                font_size = p.get('size', bottom - top)
                merged_text = p['text']
            else:
                parts.append(p)
                # Intelligently determine space insertion.
                # Do not insert space if gap is very small or if either character is Chinese.
                is_chinese = bool(merged_text and is_chinese_char(merged_text[-1])) or bool(p['text'] and is_chinese_char(p['text'][0]))
                space_str = "" if (gap < current_char_height * 0.15 or is_chinese) else " "
                merged_text += space_str + p['text']
                # Update bounds
                bottom = max(bottom, p['bottom'])
                top = min(top, p['top'])
                x1 = max(x1, p['x1'])
                # Approximate font size as average of sizes
                p_size = p.get('size', p['bottom'] - p['top'])
                font_size = (font_size + p_size) / 2.0

        if merged_text:
            merged_lines.append({
                'text': merged_text,
                'x0': x0,
                'x1': x1,
                'top': top,
                'bottom': bottom,
                'size': font_size,
                'fontname': font_name
            })
            
    return merged_lines

def convert_pdf_to_dxf(pdf_path, dxf_path):
    # Verify input exists
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"Input file not found: {pdf_path}")
        
    # Open PDF
    with pdfplumber.open(pdf_path) as pdf:
        # Create DXF doc (R2010 is widely compatible and supports lwpolyline/mtext/text)
        doc = ezdxf.new('R2010')
        msp = doc.modelspace()
        
        # Initialize standard layers
        doc.layers.new(name="LINES", dxfattribs={"color": 7})       # White/Black
        doc.layers.new(name="RECTS", dxfattribs={"color": 7})       # White/Black
        doc.layers.new(name="TEXTS", dxfattribs={"color": 3})       # Green (ACI 3)
        doc.layers.new(name="POLYLINES", dxfattribs={"color": 4})   # Cyan (ACI 4)
        doc.layers.new(name="CIRCLES", dxfattribs={"color": 1})     # Red (ACI 1)
        doc.layers.new(name="ARCS", dxfattribs={"color": 2})        # Yellow (ACI 2)
        
        # Keep track of layout horizontal offset for multi-page PDF files
        current_x_offset = 0.0
        page_gap = 50.0  # spacing between pages in DXF model space
        
        for page_idx, page in enumerate(pdf.pages):
            page_w = page.width
            page_h = page.height

            # 线段去重 + 坐标圆整：PDF 常有双绘/重复线段；浮点运算产生的
            # 坐标噪声会显著膨胀 DXF 文本体积。
            _seen_line_keys = set()

            def add_line_dedup(p0, p1, aci=7, rgb=(255, 255, 255)):
                p0 = (round(p0[0], 2), round(p0[1], 2))
                p1 = (round(p1[0], 2), round(p1[1], 2))
                ax, ay, bx, by = p0[0], p0[1], p1[0], p1[1]
                if ax > bx or (ax == bx and ay > by):
                    ax, ay, bx, by = bx, by, ax, ay
                key = (ax, ay, bx, by)
                if key in _seen_line_keys:
                    return
                _seen_line_keys.add(key)
                dxfattribs = {'layer': 'LINES', 'color': aci}
                if rgb != (255, 255, 255):
                    dxfattribs['true_color'] = ezdxf.colors.rgb2int(rgb)
                msp.add_line(p0, p1, dxfattribs=dxfattribs)

            # --- 0. Prepare Text & Spatial Index ---
            rotated_chars = [c for c in page.chars if char_is_rotated(c)]
            if rotated_chars:
                text_page = page.filter(lambda obj: not char_is_rotated(obj))
            else:
                text_page = page

            # Extract words with font info and original color
            words = text_page.extract_words(extra_attrs=["fontname", "size", "non_stroking_color"])
            word_spatial_index = SpatialWordIndex(words)
            grouped_text_lines = group_words_into_lines(words)

            # --- 1. Draw Lines with Color Fidelity ---
            for line in page.lines:
                pts = line.get('pts', [])
                if len(pts) >= 2:
                    x0, y0 = pts[0][0], pts[0][1]
                    x1, y1 = pts[1][0], pts[1][1]
                else:
                    x0, y0 = line['x0'], line['top']
                    x1, y1 = line['x1'], line['bottom']

                # Skip if this line is an internal SHX character stroke duplicating text
                min_x = min(x0, x1)
                max_x = max(x0, x1)
                min_y = min(y0, y1)
                max_y = max(y0, y1)
                if word_spatial_index.is_inside_text(min_x, min_y, max_x, max_y):
                    continue

                rgb, aci = parse_pdf_color(line.get('stroking_color'))
                x0_cad = x0 + current_x_offset
                y0_cad = page_h - y0
                x1_cad = x1 + current_x_offset
                y1_cad = page_h - y1
                add_line_dedup((x0_cad, y0_cad), (x1_cad, y1_cad), aci=aci, rgb=rgb)
                
            # --- 2. Draw Rectangles with Color Fidelity ---
            for rect in page.rects:
                x0 = rect['x0'] + current_x_offset
                y_top = page_h - rect['top']
                x1 = rect['x1'] + current_x_offset
                y_bottom = page_h - rect['bottom']
                
                w = rect['x1'] - rect['x0']
                h = rect['bottom'] - rect['top']
                rgb, aci = parse_pdf_color(rect.get('stroking_color') or rect.get('non_stroking_color'))
                
                if w <= 5.0:  # Very thin vertical line
                    x_mid = (x0 + x1) / 2
                    add_line_dedup((x_mid, y_top), (x_mid, y_bottom), aci=aci, rgb=rgb)
                elif h <= 5.0:  # Very thin horizontal line
                    y_mid = (y_top + y_bottom) / 2
                    add_line_dedup((x0, y_mid), (x1, y_mid), aci=aci, rgb=rgb)
                else:
                    vertices = [
                        (x0, y_top),
                        (x1, y_top),
                        (x1, y_bottom),
                        (x0, y_bottom)
                    ]
                    rect_attribs = {'layer': 'RECTS', 'flags': 1, 'color': aci}
                    if rgb != (255, 255, 255):
                        rect_attribs['true_color'] = ezdxf.colors.rgb2int(rgb)
                    msp.add_lwpolyline([(round(v[0], 2), round(v[1], 2)) for v in vertices],
                                       dxfattribs=rect_attribs)
                
            # --- 3. Draw Curves: CIRCLE & ARC Recognition ---
            for curve in page.curves:
                pts = curve.get('pts', [])
                if not pts:
                    continue

                # Skip if this curve is an internal SHX character stroke duplicating text
                min_x = min(pt[0] for pt in pts)
                max_x = max(pt[0] for pt in pts)
                min_y = min(pt[1] for pt in pts)
                max_y = max(pt[1] for pt in pts)
                if word_spatial_index.is_inside_text(min_x, min_y, max_x, max_y):
                    continue

                rgb, aci = parse_pdf_color(curve.get('stroking_color') or curve.get('non_stroking_color'))
                
                # Check for slanted thick lines represented as 4-vertex polygons
                clean_pts = []
                for p in pts:
                    if not clean_pts or dist(clean_pts[-1], p) > 1e-4:
                        clean_pts.append(p)
                if len(clean_pts) > 0 and dist(clean_pts[0], clean_pts[-1]) < 1e-4:
                    clean_pts.pop()
                    
                if len(clean_pts) == 4:
                    L0 = dist(clean_pts[0], clean_pts[1])
                    L1 = dist(clean_pts[1], clean_pts[2])
                    L2 = dist(clean_pts[2], clean_pts[3])
                    L3 = dist(clean_pts[3], clean_pts[0])
                    THICKNESS = 5.0
                    if L0 <= THICKNESS and L2 <= THICKNESS and L1 > L0 * 2 and L3 > L2 * 2:
                        m1 = get_midpoint(clean_pts[0], clean_pts[1])
                        m2 = get_midpoint(clean_pts[2], clean_pts[3])
                        m1 = (m1[0] + current_x_offset, page_h - m1[1])
                        m2 = (m2[0] + current_x_offset, page_h - m2[1])
                        add_line_dedup(m1, m2, aci=aci, rgb=rgb)
                        continue
                    elif L1 <= THICKNESS and L3 <= THICKNESS and L0 > L1 * 2 and L2 > L3 * 2:
                        m1 = get_midpoint(clean_pts[1], clean_pts[2])
                        m2 = get_midpoint(clean_pts[3], clean_pts[0])
                        m1 = (m1[0] + current_x_offset, page_h - m1[1])
                        m2 = (m2[0] + current_x_offset, page_h - m2[1])
                        add_line_dedup(m1, m2, aci=aci, rgb=rgb)
                        continue

                # --- High-Precision CIRCLE detection ---
                circ = fit_circle(clean_pts)
                if circ:
                    cx, cy, r = circ
                    circ_attribs = {'layer': 'CIRCLES', 'color': aci}
                    if rgb != (255, 255, 255):
                        circ_attribs['true_color'] = ezdxf.colors.rgb2int(rgb)
                    msp.add_circle((round(cx + current_x_offset, 2), round(page_h - cy, 2)),
                                   round(r, 2), dxfattribs=circ_attribs)
                    continue

                # --- Smooth ARC detection ---
                arc = fit_arc(clean_pts, page_h)
                if arc:
                    cx, cy, r, s_ang, e_ang = arc
                    arc_attribs = {'layer': 'ARCS', 'color': aci}
                    if rgb != (255, 255, 255):
                        arc_attribs['true_color'] = ezdxf.colors.rgb2int(rgb)
                    msp.add_arc((round(cx + current_x_offset, 2), round(page_h - cy, 2)),
                                round(r, 2), round(s_ang, 2), round(e_ang, 2), dxfattribs=arc_attribs)
                    continue

                # General polyline fallback
                if len(pts) >= 2:
                    vertices = [(round(x + current_x_offset, 2), round(page_h - y, 2)) for x, y in pts]
                    poly_attribs = {'layer': 'POLYLINES', 'color': aci}
                    if rgb != (255, 255, 255):
                        poly_attribs['true_color'] = ezdxf.colors.rgb2int(rgb)
                    msp.add_lwpolyline(vertices, dxfattribs=poly_attribs)
                    
            # --- 4. Draw Horizontal Texts with True Color ---
            for text_line in grouped_text_lines:
                x = text_line['x0'] + current_x_offset
                y = page_h - text_line['bottom']
                text = text_line['text']
                size = text_line['size']

                text = "".join(ch for ch in text if ch >= ' ' or ch == '\t')
                if size <= 0.1:
                    size = 8.0

                height = size * 0.75
                rgb, aci = parse_pdf_color(text_line.get('non_stroking_color') or (0, 255, 0))
                text_attribs = {
                    'layer': 'TEXTS',
                    'height': round(height, 2),
                    'insert': (round(x, 2), round(y, 2)),
                    'color': aci
                }
                if rgb != (255, 255, 255):
                    text_attribs['true_color'] = ezdxf.colors.rgb2int(rgb)

                span = text_line.get('x1', 0) - text_line.get('x0', 0)
                if span > 1e-3 and text:
                    natural_w = natural_text_width(text, height)
                    if natural_w > 1e-3:
                        width_factor = span / natural_w
                        if 0.05 < width_factor < 20.0 and abs(width_factor - 1.0) > 0.02:
                            text_attribs['width'] = width_factor

                msp.add_text(text, dxfattribs=text_attribs)

            # --- 4b. Draw Rotated / Slanted Labels with True Rotation ---
            rotated_words = group_rotated_chars_into_words(rotated_chars)
            for rw in rotated_words:
                r_text = "".join(ch for ch in rw['text'] if ch >= ' ' or ch == '\t')
                if not r_text.strip():
                    continue
                r_size = rw['size'] if rw['size'] > 0.1 else 8.0
                r_height = r_size * 0.75
                r_x = rw['x0'] + current_x_offset
                r_y = page_h - rw['bottom']
                r_rgb, r_aci = parse_pdf_color(rw.get('color') or (0, 255, 0))
                rw_attribs = {
                    'layer': 'TEXTS',
                    'height': round(r_height, 2),
                    'insert': (round(r_x, 2), round(r_y, 2)),
                    'rotation': round(rw['rotation'], 2),
                    'color': r_aci
                }
                if r_rgb != (255, 255, 255):
                    rw_attribs['true_color'] = ezdxf.colors.rgb2int(r_rgb)
                msp.add_text(r_text, dxfattribs=rw_attribs)
                
            # Update layout offset for next page
            current_x_offset += page_w + page_gap
            
        # Save DXF
        doc.saveas(dxf_path)
        
    pages_meta = []
    # Render PDF pages to PNG for side-by-side comparison
    try:
        import pypdfium2 as pdfium
        pdf_doc = pdfium.PdfDocument(pdf_path)
        base_name = os.path.splitext(dxf_path)[0]
        
        with pdfplumber.open(pdf_path) as pdf:
            for idx in range(len(pdf_doc)):
                png_path = f"{base_name}_page_{idx}.png"
                page = pdf_doc[idx]
                bitmap = page.render(scale=2.0)
                pil_img = bitmap.to_pil()
                pil_img.save(png_path)
                
                plumb_page = pdf.pages[idx]
                pages_meta.append({
                    "path": os.path.abspath(png_path),
                    "width": plumb_page.width,
                    "height": plumb_page.height
                })
    except Exception as e:
        sys.stderr.write(f"PDF Render Error: {str(e)}\n")
        
    return pages_meta

import sqlite3

def init_db(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS conversions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pdf_path TEXT,
            dxf_path TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            status TEXT,
            page_count INTEGER,
            pdf_size INTEGER,
            dxf_size INTEGER,
            error_message TEXT
        )
    """)
    # Attempt to add new columns if they don't exist
    try:
        cursor.execute("ALTER TABLE conversions ADD COLUMN pdf_hash TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE conversions ADD COLUMN pages_meta TEXT")
    except sqlite3.OperationalError:
        pass
        
    # Create subgraphs table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS subgraphs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            pdf_hash TEXT,
            dxf_path TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()

def log_conversion(db_path, pdf_path, dxf_path, status, page_count=0, pdf_size=0, dxf_size=0, error_message="", pdf_hash="", pages_meta=""):
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO conversions (pdf_path, dxf_path, status, page_count, pdf_size, dxf_size, error_message, pdf_hash, pages_meta)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (pdf_path, dxf_path, status, page_count, pdf_size, dxf_size, error_message, pdf_hash, pages_meta))
        conn.commit()
        conn.close()
    except Exception as e:
        sys.stderr.write(f"DB Log Error: {str(e)}\n")

def main():
    parser = argparse.ArgumentParser(description="Convert PDF to DXF offline with SQLite logging.")
    parser.add_argument("--input", help="Path to input PDF file.")
    parser.add_argument("--output", help="Path to save output DXF file.")
    parser.add_argument("--db", help="Path to SQLite database for logging.")
    parser.add_argument("--history-list", help="Path to SQLite database to query history.")
    parser.add_argument("--history-clear", help="Path to SQLite database to clear history.")
    parser.add_argument("--history-delete", help="ID of history item to delete.", type=int)
    parser.add_argument("--mode", help="Execution mode (default or export-subgraph).")
    parser.add_argument("--data", help="Path to JSON data file for export-subgraph mode.")
    parser.add_argument("--name", help="Name for the exported subgraph.")
    parser.add_argument("--pdf-hash", help="Hash of the original PDF.")
    
    args = parser.parse_args()
    
    # 1. Query History Mode
    if args.history_list:
        init_db(args.history_list)
        try:
            conn = sqlite3.connect(args.history_list)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            # Fetch all subgraphs grouped by pdf_hash
            cursor.execute("SELECT * FROM subgraphs")
            sub_rows = cursor.fetchall()
            subgraphs_by_hash = {}
            for sr in sub_rows:
                h = sr["pdf_hash"]
                if h not in subgraphs_by_hash:
                    subgraphs_by_hash[h] = []
                subgraphs_by_hash[h].append({
                    "id": sr["id"],
                    "name": sr["name"],
                    "pdf_hash": sr["pdf_hash"],
                    "dxf_path": sr["dxf_path"],
                    "timestamp": sr["timestamp"]
                })

            cursor.execute("SELECT id, pdf_path, dxf_path, timestamp, status, page_count, pdf_size, dxf_size, error_message, pdf_hash FROM conversions ORDER BY timestamp DESC")
            rows = cursor.fetchall()
            history = []
            for row in rows:
                h = row["pdf_hash"]
                p = row["pdf_path"]
                
                subs = []
                if h and h in subgraphs_by_hash:
                    subs.extend(subgraphs_by_hash[h])
                elif p and p in subgraphs_by_hash:
                    subs.extend(subgraphs_by_hash[p])
                    
                history.append({
                    "id": row["id"],
                    "pdf_path": row["pdf_path"],
                    "dxf_path": row["dxf_path"],
                    "timestamp": row["timestamp"],
                    "status": row["status"],
                    "page_count": row["page_count"],
                    "pdf_size": row["pdf_size"],
                    "dxf_size": row["dxf_size"],
                    "error_message": row["error_message"],
                    "pdf_hash": h,
                    "subgraphs": subs
                })
            conn.close()
            print(json.dumps(history))
            sys.exit(0)
        except Exception as e:
            print(json.dumps({"status": "error", "message": str(e)}))
            sys.exit(1)
            
    # 2. Clear History Mode
    if args.history_clear:
        init_db(args.history_clear)
        try:
            conn = sqlite3.connect(args.history_clear)
            cursor = conn.cursor()
            cursor.execute("DELETE FROM conversions")
            conn.commit()
            conn.close()
            print(json.dumps({"status": "success", "message": "History cleared"}))
            sys.exit(0)
        except Exception as e:
            print(json.dumps({"status": "error", "message": str(e)}))
            sys.exit(1)

    # 3. Delete Single History Item Mode
    if args.history_delete is not None and args.db:
        init_db(args.db)
        try:
            conn = sqlite3.connect(args.db)
            cursor = conn.cursor()
            cursor.execute("DELETE FROM conversions WHERE id = ?", (args.history_delete,))
            conn.commit()
            conn.close()
            print(json.dumps({"status": "success", "message": f"Item {args.history_delete} deleted"}))
            sys.exit(0)
        except Exception as e:
            print(json.dumps({"status": "error", "message": str(e)}))
            sys.exit(1)

    # 4. List Subgraphs Mode
    if args.mode == 'list-subgraphs' and args.db:
        init_db(args.db)
        try:
            conn = sqlite3.connect(args.db)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM subgraphs ORDER BY timestamp DESC")
            rows = cursor.fetchall()
            
            result = []
            for r in rows:
                result.append({
                    "id": r["id"],
                    "name": r["name"],
                    "pdf_hash": r["pdf_hash"],
                    "dxf_path": r["dxf_path"],
                    "timestamp": r["timestamp"]
                })
                
            conn.close()
            print(json.dumps(result))
            sys.exit(0)
        except Exception as e:
            print(json.dumps({"status": "error", "message": str(e)}))
            sys.exit(1)

    # 5. Export Subgraph Mode
    if args.mode == 'export-subgraph' and args.data and args.output:
        try:
            with open(args.data, 'r', encoding='utf-8') as f:
                entities = json.load(f)
            
            doc = ezdxf.new('R2010')
            doc.layers.add('LINES', color=7)
            doc.layers.add('RECTS', color=7)
            doc.layers.add('TEXTS', color=3)
            doc.layers.add('POLYLINES', color=4)
            msp = doc.modelspace()
            
            for ent in entities:
                ent_type = ent.get('type')
                if ent_type == 'LINE':
                    msp.add_line((ent['x0'], ent['y0']), (ent['x1'], ent['y1']), dxfattribs={'layer': 'LINES'})
                elif ent_type == 'LWPOLYLINE' or ent_type == 'RECT':
                    verts = [(v['x'], v['y']) for v in ent.get('vertices', [])]
                    if verts:
                        flags = 1 if ent.get('closed', False) else 0
                        msp.add_lwpolyline(verts, dxfattribs={'layer': 'POLYLINES', 'flags': flags})
                elif ent_type == 'TEXT':
                    msp.add_text(ent.get('text', ''), dxfattribs={
                        'layer': 'TEXTS',
                        'insert': (ent.get('x', 0), ent.get('y', 0)),
                        'height': ent.get('th', 10)
                    })
                elif ent_type == 'GROUP':
                    for child in ent.get('children', []):
                        child_type = child.get('type')
                        if child_type == 'LWPOLYLINE':
                            verts = [(v['x'], v['y']) for v in child.get('vertices', [])]
                            if verts:
                                flags = 1 if child.get('closed', False) else 0
                                msp.add_lwpolyline(verts, dxfattribs={'layer': 'POLYLINES', 'flags': flags})
                        elif child_type == 'TEXT':
                            msp.add_text(child.get('text', ''), dxfattribs={
                                'layer': 'TEXTS',
                                'insert': (child.get('x', 0), child.get('y', 0)),
                                'height': child.get('th', 10)
                            })
                            
            doc.saveas(args.output)
            
            # Log to subgraphs table
            if args.db and args.name and args.pdf_hash:
                init_db(args.db)
                try:
                    conn = sqlite3.connect(args.db)
                    cursor = conn.cursor()
                    cursor.execute(
                        "INSERT INTO subgraphs (name, pdf_hash, dxf_path) VALUES (?, ?, ?)",
                        (args.name, args.pdf_hash, os.path.abspath(args.output))
                    )
                    conn.commit()
                    conn.close()
                except Exception as ex:
                    # Ignore db errors if any, but they shouldn't block the success response
                    pass
            
            print(json.dumps({"status": "success", "saved_to": os.path.abspath(args.output)}))
            sys.exit(0)
        except Exception as e:
            print(json.dumps({"status": "error", "message": str(e)}))
            sys.exit(1)

    # 5. Standard Conversion Mode
    if args.input and args.output:
        db_path = args.db
        if db_path:
            init_db(db_path)
            
        pdf_size = 0
        pdf_hash = ""
        try:
            if os.path.exists(args.input):
                pdf_size = os.path.getsize(args.input)
                import hashlib
                with open(args.input, 'rb') as f:
                    pdf_hash = hashlib.md5(f.read()).hexdigest()
        except:
            pass
            
        # Check cache before doing the heavy conversion
        if db_path and pdf_hash:
            try:
                conn = sqlite3.connect(db_path)
                cursor = conn.cursor()
                cursor.execute("SELECT dxf_path, page_count, pages_meta FROM conversions WHERE pdf_hash = ? AND status = 'success' ORDER BY timestamp DESC LIMIT 1", (pdf_hash,))
                row = cursor.fetchone()
                conn.close()
                if row:
                    cached_dxf = row[0]
                    cached_pages = row[1]
                    cached_meta_str = row[2]
                    
                    if cached_dxf and os.path.exists(cached_dxf):
                        import shutil
                        shutil.copy2(cached_dxf, args.output)
                        old_base = os.path.splitext(cached_dxf)[0]
                        new_base = os.path.splitext(args.output)[0]
                        
                        pages_meta = []
                        if cached_meta_str:
                            try:
                                pages_meta = json.loads(cached_meta_str)
                            except:
                                pass
                                
                        for idx in range(cached_pages):
                            old_png = f"{old_base}_page_{idx}.png"
                            new_png = f"{new_base}_page_{idx}.png"
                            if os.path.exists(old_png):
                                shutil.copy2(old_png, new_png)
                                if idx < len(pages_meta):
                                    pages_meta[idx]['path'] = os.path.abspath(new_png)
                        
                        result = {
                            "status": "success",
                            "saved_to": os.path.abspath(args.output),
                            "pdf_pages": pages_meta,
                            "cached": True,
                            "pdf_hash": pdf_hash
                        }
                        print(json.dumps(result))
                        sys.exit(0)
            except Exception as e:
                # If cache read fails, just proceed to normal conversion
                pass
                
        try:
            pages_meta = convert_pdf_to_dxf(args.input, args.output)
            
            dxf_size = 0
            try:
                if os.path.exists(args.output):
                    dxf_size = os.path.getsize(args.output)
            except:
                pass
                
            if db_path:
                meta_str = json.dumps(pages_meta) if pages_meta else ""
                log_conversion(db_path, args.input, args.output, "success", len(pages_meta), pdf_size, dxf_size, "", pdf_hash, meta_str)
                
            result = {
                "status": "success",
                "saved_to": os.path.abspath(args.output),
                "pdf_pages": pages_meta,
                "pdf_hash": pdf_hash
            }
            print(json.dumps(result))
            sys.exit(0)
        except Exception as e:
            err_msg = str(e)
            if db_path:
                log_conversion(db_path, args.input, args.output, "error", 0, pdf_size, 0, err_msg, pdf_hash, "")
            result = {
                "status": "error",
                "message": err_msg
            }
            print(json.dumps(result))
            sys.exit(1)
            
    # If no valid arguments provided
    parser.print_help()
    sys.exit(1)

if __name__ == "__main__":
    main()
