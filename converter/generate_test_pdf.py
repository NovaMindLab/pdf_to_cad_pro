from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter

def generate_test_pdf(filename="test.pdf"):
    # Create canvas
    c = canvas.Canvas(filename, pagesize=letter)
    width, height = letter
    
    # 1. Draw some lines (LINES layer test)
    c.setStrokeColorRGB(0, 0, 0)
    c.setLineWidth(1)
    c.line(100, 100, 500, 100) # Horizontal line
    c.line(100, 100, 100, 600) # Vertical line
    c.line(100, 600, 500, 600) # Horizontal line
    c.line(500, 100, 500, 600) # Vertical line
    
    # 2. Draw a rectangle (RECTS layer test)
    c.rect(150, 150, 300, 100, fill=0, stroke=1)
    
    # 3. Draw a curve/path (POLYLINES layer test)
    p = c.beginPath()
    p.moveTo(200, 300)
    p.lineTo(250, 350)
    p.lineTo(300, 300)
    p.lineTo(350, 350)
    p.lineTo(400, 300)
    c.drawPath(p, fill=0, stroke=1)
    
    # 4. Draw some text (TEXTS layer test)
    c.setFont("Helvetica", 14)
    c.drawString(200, 500, "CAD Conversion Test String")
    
    c.setFont("Helvetica-Bold", 10)
    c.drawString(200, 470, "Subtitle: Vector Elements")
    
    c.setFont("Helvetica", 8)
    c.drawString(200, 440, "Small detail text here.")
    
    # Save the page and file
    c.showPage()
    c.save()
    print(f"Generated test PDF: {filename}")

if __name__ == "__main__":
    generate_test_pdf()
