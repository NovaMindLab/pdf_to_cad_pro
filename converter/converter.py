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

def group_words_into_lines(words, tolerance=3.0):
    """
    Groups pdfplumber word dictionaries into cohesive text lines based on vertical baseline alignment
    and horizontal proximity.
    """
    if not words:
        return []
    
    # Group words that have similar vertical alignment (top coordinate)
    lines = []
    # Sort primarily by vertical top coordinate, secondarily by horizontal x0
    sorted_words = sorted(words, key=lambda w: (w['top'], w['x0']))
    
    current_line = []
    current_top = None
    
    for word in sorted_words:
        if current_top is None:
            current_top = word['top']
            current_line.append(word)
        else:
            word_height = word['bottom'] - word['top']
            thresh = max(tolerance, word_height * 0.4)
            if abs(word['top'] - current_top) <= thresh:
                current_line.append(word)
            else:
                # Close current line group, start new one
                lines.append(current_line)
                current_line = [word]
                current_top = word['top']
                
    if current_line:
        lines.append(current_line)
        
    # Process each horizontal line group: sort left-to-right and merge words
    merged_lines = []
    for line in lines:
        sorted_line = sorted(line, key=lambda w: w['x0'])
        
        # Merge words that are close horizontally.
        # If there's a large gap between adjacent words (e.g. columns or tables),
        # treat them as separate text entities in CAD.
        parts = [sorted_line[0]]
        x0 = sorted_line[0]['x0']
        top = sorted_line[0]['top']
        bottom = sorted_line[0]['bottom']
        font_name = sorted_line[0].get('fontname', 'Standard')
        font_size = sorted_line[0].get('size', bottom - top)
        
        merged_text = sorted_line[0]['text']
        
        for p in sorted_line[1:]:
            gap = p['x0'] - parts[-1]['x1']
            current_char_height = p['bottom'] - p['top']
            
            # If the horizontal gap is larger than 3 times the character height,
            # split it into a separate CAD text entity (e.g. columns)
            if gap > current_char_height * 3.0:
                merged_lines.append({
                    'text': merged_text,
                    'x0': x0,
                    'top': top,
                    'bottom': bottom,
                    'size': font_size,
                    'fontname': font_name
                })
                # Reset for new text entity
                parts = [p]
                x0 = p['x0']
                top = p['top']
                bottom = p['bottom']
                font_name = p.get('fontname', 'Standard')
                font_size = p.get('size', bottom - top)
                merged_text = p['text']
            else:
                parts.append(p)
                # Intelligently determine space insertion.
                # Do not insert space if gap is very small or if either character is Chinese.
                is_chinese = False
                if merged_text and is_chinese_char(merged_text[-1]):
                    is_chinese = True
                if p['text'] and is_chinese_char(p['text'][0]):
                    is_chinese = True
                
                space_str = "" if (gap < current_char_height * 0.15 or is_chinese) else " "
                merged_text += space_str + p['text']
                # Update bounds
                bottom = max(bottom, p['bottom'])
                top = min(top, p['top'])
                # Approximate font size as average of sizes
                p_size = p.get('size', p['bottom'] - p['top'])
                font_size = (font_size + p_size) / 2.0
                
        if merged_text:
            merged_lines.append({
                'text': merged_text,
                'x0': x0,
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
        
        # Keep track of layout horizontal offset for multi-page PDF files
        current_x_offset = 0.0
        page_gap = 50.0  # spacing between pages in DXF model space
        
        for page_idx, page in enumerate(pdf.pages):
            page_w = page.width
            page_h = page.height
            
            # --- 1. Draw Lines ---
            for line in page.lines:
                pts = line.get('pts', [])
                if len(pts) >= 2:
                    x0, y0 = pts[0][0], pts[0][1]
                    x1, y1 = pts[1][0], pts[1][1]
                else:
                    x0, y0 = line['x0'], line['top']
                    x1, y1 = line['x1'], line['bottom']
                
                x0_cad = x0 + current_x_offset
                y0_cad = page_h - y0
                x1_cad = x1 + current_x_offset
                y1_cad = page_h - y1
                msp.add_line((x0_cad, y0_cad), (x1_cad, y1_cad), dxfattribs={'layer': 'LINES'})
                
            # --- 2. Draw Rectangles ---
            for rect in page.rects:
                x0 = rect['x0'] + current_x_offset
                y_top = page_h - rect['top']
                x1 = rect['x1'] + current_x_offset
                y_bottom = page_h - rect['bottom']
                
                w = rect['x1'] - rect['x0']
                h = rect['bottom'] - rect['top']
                
                # Check if it is actually a thin line represented as a filled rectangle
                if w <= 5.0:  # Very thin vertical line
                    x_mid = (x0 + x1) / 2
                    msp.add_line((x_mid, y_top), (x_mid, y_bottom), dxfattribs={'layer': 'LINES'})
                elif h <= 5.0:  # Very thin horizontal line
                    y_mid = (y_top + y_bottom) / 2
                    msp.add_line((x0, y_mid), (x1, y_mid), dxfattribs={'layer': 'LINES'})
                else:
                    # closed rectangle polyline
                    vertices = [
                        (x0, y_top),
                        (x1, y_top),
                        (x1, y_bottom),
                        (x0, y_bottom)
                    ]
                    # lwpolyline requires list of (x, y) tuples. 
                    # dxfattribs flags: 1 = closed polyline
                    msp.add_lwpolyline(vertices, dxfattribs={'layer': 'RECTS', 'flags': 1})
                
            # --- 3. Draw Curves / Polylines ---
            for curve in page.curves:
                pts = curve.get('pts', [])
                
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
                        msp.add_line(m1, m2, dxfattribs={'layer': 'LINES'})
                        continue
                    elif L1 <= THICKNESS and L3 <= THICKNESS and L0 > L1 * 2 and L2 > L3 * 2:
                        m1 = get_midpoint(clean_pts[1], clean_pts[2])
                        m2 = get_midpoint(clean_pts[3], clean_pts[0])
                        m1 = (m1[0] + current_x_offset, page_h - m1[1])
                        m2 = (m2[0] + current_x_offset, page_h - m2[1])
                        msp.add_line(m1, m2, dxfattribs={'layer': 'LINES'})
                        continue

                if len(pts) >= 2:
                    vertices = [(x + current_x_offset, page_h - y) for x, y in pts]
                    msp.add_lwpolyline(vertices, dxfattribs={'layer': 'POLYLINES'})
                    
            # --- 4. Draw Texts ---
            # Extract words with font info
            words = page.extract_words(extra_attrs=["fontname", "size"])
            grouped_text_lines = group_words_into_lines(words)
            
            for text_line in grouped_text_lines:
                x = text_line['x0'] + current_x_offset
                # pdfplumber bottom is distance from top of page. 
                # DXF insert point for text baseline is bottom of text.
                y = page_h - text_line['bottom']
                text = text_line['text']
                size = text_line['size']
                
                # Sanitize text to remove control characters/newlines that break DXF
                text = "".join(ch for ch in text if ch >= ' ' or ch == '\t')
                
                if size <= 0.1:
                    size = 8.0 # fallback
                
                # Scale down height slightly to match CAD fonts aspect ratio and prevent overlaps
                height = size * 0.75
                    
                # Add text entity
                msp.add_text(
                    text,
                    dxfattribs={
                        'layer': 'TEXTS',
                        'height': height,
                        'insert': (x, y)
                    }
                )
                
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
