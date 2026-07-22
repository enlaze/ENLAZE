#!/usr/bin/env python3
"""Generate accounting PDF report from JSON data (stdin)."""

import json
import sys
from datetime import datetime

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas
from reportlab.lib.enums import TA_RIGHT, TA_CENTER, TA_LEFT
from reportlab.platypus import Table, TableStyle

# Brand colors
BRAND_GREEN = HexColor("#00c896")
NAVY_DARK = HexColor("#0f2744")
NAVY_MID = HexColor("#3b5068")
NAVY_LIGHT = HexColor("#8899a8")
BG_GRAY = HexColor("#f4f7fa")
WHITE = HexColor("#ffffff")
RED = HexColor("#dc2626")
GREEN = HexColor("#16a34a")

STATUS_LABELS = {
    "paid": "Pagada",
    "pending": "Pendiente",
    "overdue": "Vencida",
    "cancelled": "Anulada",
}


def eur(n):
    """Format number as EUR."""
    return f"{n:,.2f} EUR".replace(",", "X").replace(".", ",").replace("X", ".")


def draw_header(c, w, h, data):
    """Draw the report header."""
    # Background bar
    c.setFillColor(NAVY_DARK)
    c.roundRect(20 * mm, h - 45 * mm, w - 40 * mm, 30 * mm, 4 * mm, fill=1, stroke=0)

    # Logo text
    c.setFillColor(BRAND_GREEN)
    c.setFont("Helvetica-Bold", 20)
    c.drawString(28 * mm, h - 32 * mm, "Enlaze")

    # Title
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(65 * mm, h - 28 * mm, "Informe Contable")

    # Period
    c.setFont("Helvetica", 11)
    c.drawString(65 * mm, h - 36 * mm, f"Periodo: {data['periodLabel']}")

    # Company info
    c.setFillColor(WHITE)
    c.setFont("Helvetica", 9)
    company = data.get("companyName", "")
    nif = data.get("companyNif", "")
    if company:
        c.drawRightString(w - 28 * mm, h - 28 * mm, company)
    if nif:
        c.drawRightString(w - 28 * mm, h - 36 * mm, f"NIF: {nif}")

    # Date
    c.setFillColor(NAVY_LIGHT)
    c.setFont("Helvetica", 8)
    c.drawRightString(w - 20 * mm, h - 50 * mm, f"Generado: {datetime.now().strftime('%d/%m/%Y %H:%M')}")

    return h - 58 * mm


def draw_summary(c, y, w, data):
    """Draw the summary KPI cards."""
    totals = data["totals"]
    rec = totals["received"]
    iss = totals["issued"]

    card_w = (w - 40 * mm - 10 * mm) / 3
    card_h = 28 * mm
    x_start = 20 * mm

    cards = [
        {"label": "Facturas recibidas", "value": eur(rec["total"]), "count": f"{rec['count']} facturas", "color": RED},
        {"label": "Facturas emitidas", "value": eur(iss["total"]), "count": f"{iss['count']} facturas", "color": GREEN},
        {"label": "Resultado IVA", "value": eur(iss["iva"] - rec["iva"]),
         "count": f"IVA repercutido - IVA soportado", "color": BRAND_GREEN},
    ]

    for i, card in enumerate(cards):
        x = x_start + i * (card_w + 5 * mm)

        # Card background
        c.setFillColor(BG_GRAY)
        c.roundRect(x, y - card_h, card_w, card_h, 3 * mm, fill=1, stroke=0)

        # Label
        c.setFillColor(NAVY_LIGHT)
        c.setFont("Helvetica", 7)
        c.drawString(x + 4 * mm, y - 8 * mm, card["label"])

        # Value
        c.setFillColor(card["color"])
        c.setFont("Helvetica-Bold", 14)
        c.drawString(x + 4 * mm, y - 17 * mm, card["value"])

        # Count
        c.setFillColor(NAVY_LIGHT)
        c.setFont("Helvetica", 7)
        c.drawString(x + 4 * mm, y - 24 * mm, card["count"])

    return y - card_h - 10 * mm


def draw_table(c, y, w, title, rows, headers, color):
    """Draw a table of invoices."""
    if not rows:
        return y

    # Section title
    c.setFillColor(color)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(20 * mm, y, title)
    y -= 6 * mm

    # Table headers
    col_widths = [22 * mm, 38 * mm, 22 * mm, 20 * mm, 24 * mm, 20 * mm, 20 * mm, 24 * mm]
    table_w = sum(col_widths)

    # Build table data
    table_data = [headers]
    for row in rows:
        date_str = row.get("date", "")
        try:
            date_fmt = datetime.strptime(date_str, "%Y-%m-%d").strftime("%d/%m/%Y")
        except (ValueError, TypeError):
            date_fmt = date_str
        status = STATUS_LABELS.get(row.get("status", ""), row.get("status", ""))
        table_data.append([
            row.get("number", ""),
            (row.get("supplier", "") or row.get("client", ""))[:22],
            row.get("nif", ""),
            date_fmt,
            eur(row.get("base", 0)),
            eur(row.get("iva", 0)),
            eur(row.get("irpf", 0)),
            eur(row.get("total", 0)),
        ])

    # Check if we need a new page
    table_height = len(table_data) * 5.5 * mm + 2 * mm
    if y - table_height < 30 * mm:
        c.showPage()
        y = A4[1] - 20 * mm

    # Draw table
    t = Table(table_data, colWidths=col_widths)
    style = TableStyle([
        # Header
        ("BACKGROUND", (0, 0), (-1, 0), NAVY_DARK),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 7),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 4),
        ("TOPPADDING", (0, 0), (-1, 0), 4),
        # Body
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 1), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 3),
        ("TOPPADDING", (0, 1), (-1, -1), 3),
        ("TEXTCOLOR", (0, 1), (-1, -1), NAVY_MID),
        # Alignment
        ("ALIGN", (4, 0), (-1, -1), "RIGHT"),
        ("ALIGN", (3, 0), (3, -1), "CENTER"),
        # Zebra striping
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, BG_GRAY]),
        # Grid
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, BRAND_GREEN),
        ("LINEBELOW", (0, -1), (-1, -1), 0.5, NAVY_DARK),
        # Round corners via padding
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
    ])
    t.setStyle(style)

    tw, th = t.wrap(table_w, 500 * mm)
    t.drawOn(c, 20 * mm, y - th)

    return y - th - 8 * mm


def draw_totals_row(c, y, w, label, totals, color):
    """Draw a totals summary row."""
    c.setFillColor(color)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(20 * mm, y, label)

    c.setFillColor(NAVY_DARK)
    c.setFont("Helvetica", 8)
    items = [
        f"Base: {eur(totals['base'])}",
        f"IVA: {eur(totals['iva'])}",
        f"IRPF: {eur(totals['irpf'])}",
    ]
    x = 70 * mm
    for item in items:
        c.drawString(x, y, item)
        x += 40 * mm

    c.setFont("Helvetica-Bold", 10)
    c.drawRightString(w - 20 * mm, y, f"Total: {eur(totals['total'])}")

    return y - 10 * mm


def draw_fiscal_summary(c, y, w, data):
    """Draw the fiscal summary section."""
    totals = data["totals"]

    # Check page space
    if y < 60 * mm:
        c.showPage()
        y = A4[1] - 20 * mm

    # Title
    c.setFillColor(NAVY_DARK)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(20 * mm, y, "Resumen fiscal")
    y -= 8 * mm

    # IVA box
    c.setFillColor(BG_GRAY)
    c.roundRect(20 * mm, y - 30 * mm, (w - 40 * mm) / 2 - 3 * mm, 30 * mm, 3 * mm, fill=1, stroke=0)

    c.setFillColor(NAVY_MID)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(25 * mm, y - 6 * mm, "IVA")

    c.setFont("Helvetica", 8)
    c.setFillColor(NAVY_MID)
    c.drawString(25 * mm, y - 13 * mm, f"IVA repercutido (emitidas): {eur(totals['issued']['iva'])}")
    c.drawString(25 * mm, y - 19 * mm, f"IVA soportado (recibidas): {eur(totals['received']['iva'])}")

    resultado_iva = totals["issued"]["iva"] - totals["received"]["iva"]
    c.setFont("Helvetica-Bold", 9)
    c.setFillColor(RED if resultado_iva > 0 else GREEN)
    c.drawString(25 * mm, y - 26 * mm, f"Resultado: {eur(resultado_iva)} {'(a ingresar)' if resultado_iva > 0 else '(a compensar)'}")

    # IRPF box
    irpf_x = 20 * mm + (w - 40 * mm) / 2 + 3 * mm
    c.setFillColor(BG_GRAY)
    c.roundRect(irpf_x, y - 30 * mm, (w - 40 * mm) / 2 - 3 * mm, 30 * mm, 3 * mm, fill=1, stroke=0)

    c.setFillColor(NAVY_MID)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(irpf_x + 5 * mm, y - 6 * mm, "IRPF / Retenciones")

    c.setFont("Helvetica", 8)
    c.drawString(irpf_x + 5 * mm, y - 13 * mm, f"Retenciones recibidas: {eur(totals['received']['irpf'])}")
    c.drawString(irpf_x + 5 * mm, y - 19 * mm, f"Retenciones emitidas: {eur(totals['issued']['irpf'])}")

    resultado_irpf = totals["received"]["irpf"] - totals["issued"]["irpf"]
    c.setFont("Helvetica-Bold", 9)
    c.setFillColor(NAVY_DARK)
    c.drawString(irpf_x + 5 * mm, y - 26 * mm, f"Total retenciones: {eur(resultado_irpf)}")

    return y - 40 * mm


def draw_footer(c, w):
    """Draw the page footer."""
    c.setFillColor(NAVY_LIGHT)
    c.setFont("Helvetica", 7)
    c.drawString(20 * mm, 12 * mm, "Documento generado por Enlaze · enlaze.es")
    c.drawRightString(w - 20 * mm, 12 * mm, f"Pagina {c.getPageNumber()}")
    c.setStrokeColor(HexColor("#e8eef4"))
    c.line(20 * mm, 16 * mm, w - 20 * mm, 16 * mm)


def main():
    data = json.loads(sys.stdin.read())
    output_path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/contabilidad.pdf"

    w, h = A4
    c = canvas.Canvas(output_path, pagesize=A4)
    c.setTitle(f"Informe Contable - {data['periodLabel']}")

    # Header
    y = draw_header(c, w, h, data)

    # Summary cards
    y = draw_summary(c, y, w, data)

    # Received invoices table
    if data.get("received"):
        y = draw_table(
            c, y, w,
            f"Facturas recibidas ({len(data['received'])})",
            data["received"],
            ["N. Factura", "Proveedor", "NIF", "Fecha", "Base", "IVA", "IRPF", "Total"],
            RED,
        )
        y = draw_totals_row(c, y, w, "Total recibidas", data["totals"]["received"], RED)

    # Issued invoices table
    if data.get("issued"):
        # Check page space
        if y < 50 * mm:
            draw_footer(c, w)
            c.showPage()
            y = h - 20 * mm

        y = draw_table(
            c, y, w,
            f"Facturas emitidas ({len(data['issued'])})",
            data["issued"],
            ["N. Factura", "Cliente", "NIF", "Fecha", "Base", "IVA", "IRPF", "Total"],
            GREEN,
        )
        y = draw_totals_row(c, y, w, "Total emitidas", data["totals"]["issued"], GREEN)

    # Fiscal summary
    y = draw_fiscal_summary(c, y, w, data)

    # Footer
    draw_footer(c, w)

    c.save()
    print(output_path)


if __name__ == "__main__":
    main()
