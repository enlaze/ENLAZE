#!/usr/bin/env python3
"""
Professional Budget PDF Generator for ENLAZE
Generates A4 PDF with:
- Cover page with company + client info
- One page per partida/estancia grouping
- Company NIF, signature blocks on each page
- Totals summary page with dual signatures
"""

import json
import sys
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm, cm
from reportlab.lib.colors import HexColor, black, white, Color
from reportlab.pdfgen import canvas
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import Table, TableStyle
from datetime import datetime

# ── Colors ──────────────────────────────────────────────────────────────────
BRAND_GREEN = HexColor("#00c896")
NAVY_900 = HexColor("#0a1628")
NAVY_700 = HexColor("#1e3a5f")
NAVY_500 = HexColor("#475569")
NAVY_200 = HexColor("#cbd5e1")
GRAY_50 = HexColor("#f8fafc")
GRAY_100 = HexColor("#f1f5f9")
WHITE = white

W, H = A4  # 210mm x 297mm


# Global page counter — set by generate_pdf, read by draw_footer
_page_counter = [0, 0]  # [current_page, total_pages]

def safe(d, key, default=""):
    """Get value from dict, returning default if key is missing or value is None."""
    v = d.get(key, default)
    return v if v is not None else default

def fmt(n):
    """Format number as currency string."""
    if n is None:
        n = 0
    return f"{n:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".") + " EUR"

def draw_header(c, budget, company, page_num=0, total_pages=0):
    """Draw consistent header on every page."""
    # Top bar
    c.setFillColor(NAVY_900)
    c.rect(0, H - 28*mm, W, 28*mm, fill=1, stroke=0)

    # Logo
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 22)
    c.drawString(15*mm, H - 20*mm, "enlaze")
    c.setFillColor(BRAND_GREEN)
    c.drawString(15*mm + c.stringWidth("enl", "Helvetica-Bold", 22), H - 20*mm, "a")
    c.setFillColor(WHITE)
    c.drawString(15*mm + c.stringWidth("enla", "Helvetica-Bold", 22), H - 20*mm, "ze")

    # Budget number + date
    c.setFont("Helvetica", 9)
    c.setFillColor(HexColor("#94a3b8"))
    c.drawRightString(W - 15*mm, H - 13*mm, f"{safe(budget, 'budget_number', '')}")
    c.drawRightString(W - 15*mm, H - 19*mm, f"Fecha: {safe(budget, 'date', '')}")
    if safe(budget, 'valid_until'):
        c.drawRightString(W - 15*mm, H - 25*mm, f"Valido hasta: {budget['valid_until']}")

    # Company info line below header
    c.setFillColor(GRAY_100)
    c.rect(0, H - 38*mm, W, 10*mm, fill=1, stroke=0)
    c.setFont("Helvetica-Bold", 8)
    c.setFillColor(NAVY_700)
    company_line = safe(company, 'name', '')
    if safe(company, 'nif'):
        company_line += f"  |  NIF: {company['nif']}"
    if safe(company, 'address'):
        company_line += f"  |  {company['address']}"
    if safe(company, 'phone'):
        company_line += f"  |  Tel: {company['phone']}"
    if safe(company, 'email'):
        company_line += f"  |  {company['email']}"
    c.drawString(15*mm, H - 35*mm, company_line)

def draw_footer(c, company):
    """Draw footer with company info and page number."""
    c.setStrokeColor(NAVY_200)
    c.setLineWidth(0.5)
    c.line(15*mm, 18*mm, W - 15*mm, 18*mm)

    c.setFont("Helvetica", 7)
    c.setFillColor(NAVY_500)
    c.drawString(15*mm, 13*mm, f"Presupuesto generado con Enlaze | enlaze.es")
    c.drawRightString(W - 15*mm, 13*mm, "Este presupuesto tiene validez contractual una vez aceptado por ambas partes.")

    # Page number (skip cover page)
    cur, total = _page_counter
    if cur > 0:
        c.drawRightString(W - 15*mm, 8*mm, f"Pagina {cur} de {total}")

def draw_signature_blocks(c, y, company, client_name):
    """Draw dual signature blocks (company + client)."""
    block_w = 75*mm
    left_x = 15*mm
    right_x = W - 15*mm - block_w

    # Company signature
    c.setFont("Helvetica-Bold", 9)
    c.setFillColor(NAVY_900)
    c.drawString(left_x, y, "Por la empresa:")
    c.setFont("Helvetica", 8)
    c.setFillColor(NAVY_500)
    c.drawString(left_x, y - 14, safe(company, 'name', ''))
    if safe(company, 'nif'):
        c.drawString(left_x, y - 26, f"NIF: {company['nif']}")

    # Signature line
    c.setStrokeColor(NAVY_200)
    c.setLineWidth(0.5)
    c.line(left_x, y - 55, left_x + block_w, y - 55)
    c.setFont("Helvetica", 7)
    c.setFillColor(NAVY_500)
    c.drawString(left_x, y - 63, "Firma y sello")

    # Client signature
    c.setFont("Helvetica-Bold", 9)
    c.setFillColor(NAVY_900)
    c.drawString(right_x, y, "Por el cliente:")
    c.setFont("Helvetica", 8)
    c.setFillColor(NAVY_500)
    c.drawString(right_x, y - 14, client_name or "")

    c.line(right_x, y - 55, right_x + block_w, y - 55)
    c.setFont("Helvetica", 7)
    c.setFillColor(NAVY_500)
    c.drawString(right_x, y - 63, "Firma del cliente")

    # Date line
    c.setFont("Helvetica", 8)
    c.setFillColor(NAVY_500)
    date_y = y - 80
    c.drawString(left_x, date_y, f"En _________________, a ______ de _________________ de {datetime.now().year}")


def draw_cover_page(c, budget, company, items):
    """Page 1: Cover with company info, client info, and summary."""
    # Full green accent bar on left
    c.setFillColor(BRAND_GREEN)
    c.rect(0, 0, 6*mm, H, fill=1, stroke=0)

    # Large title area
    c.setFillColor(NAVY_900)
    c.rect(6*mm, H - 90*mm, W - 6*mm, 90*mm, fill=1, stroke=0)

    # Logo big
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 36)
    c.drawString(25*mm, H - 40*mm, "enlaze")
    c.setFillColor(BRAND_GREEN)
    logo_x = 25*mm + c.stringWidth("enl", "Helvetica-Bold", 36)
    c.drawString(logo_x, H - 40*mm, "a")
    c.setFillColor(WHITE)
    c.drawString(logo_x + c.stringWidth("a", "Helvetica-Bold", 36), H - 40*mm, "ze")

    # Title
    c.setFont("Helvetica-Bold", 24)
    c.setFillColor(WHITE)
    c.drawString(25*mm, H - 60*mm, "PRESUPUESTO")

    # Budget number
    c.setFont("Helvetica", 14)
    c.setFillColor(BRAND_GREEN)
    c.drawString(25*mm, H - 72*mm, safe(budget, 'budget_number', ''))

    # Title of the budget
    c.setFont("Helvetica", 12)
    c.setFillColor(HexColor("#94a3b8"))
    title = safe(budget, 'title', '')
    if len(title) > 60:
        title = title[:57] + "..."
    c.drawString(25*mm, H - 82*mm, title)

    y = H - 105*mm

    # Company info block — placed on the LEFT half
    left_x = 25*mm
    right_x = W / 2 + 5*mm
    block_top = y + 40

    c.setFillColor(BRAND_GREEN)
    c.rect(left_x, y - 15, 4, 55, fill=1, stroke=0)

    c.setFont("Helvetica-Bold", 9)
    c.setFillColor(BRAND_GREEN)
    c.drawString(left_x + 7, block_top, "DATOS DE LA EMPRESA")

    c.setFont("Helvetica-Bold", 11)
    c.setFillColor(NAVY_900)
    c.drawString(left_x + 7, block_top - 16, safe(company, 'name', 'Sin nombre de empresa'))

    info_y = block_top - 30
    c.setFont("Helvetica", 9)
    c.setFillColor(NAVY_500)
    if safe(company, 'nif'):
        c.drawString(left_x + 7, info_y, f"NIF/CIF: {company['nif']}")
        info_y -= 12
    if safe(company, 'address'):
        addr = company['address']
        if len(addr) > 40:
            addr = addr[:37] + "..."
        c.drawString(left_x + 7, info_y, addr)
        info_y -= 12
    if safe(company, 'phone'):
        c.drawString(left_x + 7, info_y, f"Tel: {company['phone']}")
        info_y -= 12
    if safe(company, 'email'):
        c.drawString(left_x + 7, info_y, company['email'])

    # Client info block — placed on the RIGHT half (same vertical level)
    c.setFillColor(NAVY_700)
    c.rect(right_x, y - 15, 4, 55, fill=1, stroke=0)

    c.setFont("Helvetica-Bold", 9)
    c.setFillColor(NAVY_700)
    c.drawString(right_x + 7, block_top, "DATOS DEL CLIENTE")

    c.setFont("Helvetica-Bold", 11)
    c.setFillColor(NAVY_900)
    c.drawString(right_x + 7, block_top - 16, safe(budget, 'client_name', 'Sin cliente'))

    info_y = block_top - 30
    c.setFont("Helvetica", 9)
    c.setFillColor(NAVY_500)
    if safe(budget, 'client_email'):
        c.drawString(right_x + 7, info_y, f"Email: {budget['client_email']}")
        info_y -= 12
    if safe(budget, 'client_phone'):
        c.drawString(right_x + 7, info_y, f"Tel: {budget['client_phone']}")
        info_y -= 12
    if safe(budget, 'client_address'):
        addr = budget['client_address']
        if len(addr) > 35:
            addr = addr[:32] + "..."
        c.drawString(right_x + 7, info_y, f"Dir: {addr}")

    y = y - 35

    # Summary box
    c.setFillColor(GRAY_50)
    c.roundRect(25*mm, y - 60, W - 50*mm, 55, 6, fill=1, stroke=0)

    c.setStrokeColor(BRAND_GREEN)
    c.setLineWidth(2)
    c.line(25*mm, y - 5, 25*mm + W - 50*mm, y - 5)

    c.setFont("Helvetica-Bold", 10)
    c.setFillColor(NAVY_900)
    c.drawString(30*mm, y - 18, "RESUMEN")

    subtotal = float(budget.get('subtotal') or 0)
    iva_pct = float(budget.get('iva_percent') or 21)
    iva_amount = float(budget.get('iva_amount') or 0)
    total = float(budget.get('total') or 0)

    c.setFont("Helvetica", 10)
    c.setFillColor(NAVY_500)
    c.drawString(30*mm, y - 32, "Subtotal")
    c.drawRightString(W - 30*mm, y - 32, fmt(subtotal))

    c.drawString(30*mm, y - 44, f"IVA ({iva_pct}%)")
    c.drawRightString(W - 30*mm, y - 44, fmt(iva_amount))

    c.setFont("Helvetica-Bold", 14)
    c.setFillColor(BRAND_GREEN)
    c.drawString(30*mm, y - 58, "TOTAL")
    c.drawRightString(W - 30*mm, y - 58, fmt(total))

    # Date info
    y = y - 80
    c.setFont("Helvetica", 9)
    c.setFillColor(NAVY_500)
    c.drawString(25*mm, y, f"Fecha de emision: {safe(budget, 'date', '')}")
    if safe(budget, 'valid_until'):
        c.drawString(25*mm, y - 14, f"Valido hasta: {budget['valid_until']}")

    c.drawString(25*mm, y - 28, f"Numero de partidas: {len(items)}")

    # Footer on cover
    c.setFont("Helvetica", 7)
    c.setFillColor(NAVY_500)
    c.drawCentredString(W / 2, 10*mm, "Presupuesto generado con Enlaze | enlaze.es")


def _build_table_style(num_rows, is_subtotal_row=True):
    """Build a consistent table style for partida tables."""
    last_body = -2 if is_subtotal_row else -1
    style_cmds = [
        # Header
        ('BACKGROUND', (0, 0), (-1, 0), NAVY_900),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 8),
        ('ALIGN', (0, 0), (0, -1), 'CENTER'),
        ('ALIGN', (2, 0), (2, -1), 'CENTER'),
        ('ALIGN', (3, 0), (3, -1), 'CENTER'),
        ('ALIGN', (4, 0), (-1, -1), 'RIGHT'),
        # Body
        ('FONTNAME', (0, 1), (-1, last_body), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, last_body), 8),
        ('TEXTCOLOR', (0, 1), (-1, last_body), NAVY_700),
        ('ROWBACKGROUNDS', (0, 1), (-1, last_body), [WHITE, GRAY_50]),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        # Grid
        ('GRID', (0, 0), (-1, -1), 0.5, NAVY_200),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]
    if is_subtotal_row:
        style_cmds += [
            ('BACKGROUND', (0, -1), (-1, -1), GRAY_100),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, -1), (-1, -1), 9),
            ('TEXTCOLOR', (0, -1), (-1, -1), NAVY_900),
        ]
    return TableStyle(style_cmds)


COL_WIDTHS = [10*mm, 72*mm, 15*mm, 18*mm, 25*mm, 28*mm]
HEADER_ROW = ["#", "Concepto", "Ud.", "Cant.", "Precio Ud.", "Importe"]
# Usable area: below page header (48mm from top) to above footer/signatures (40mm from bottom)
TOP_Y = H - 48*mm
BOTTOM_Y = 40*mm
# Space needed for chapter title block
TITLE_BLOCK_H = 25
# Space needed for signature blocks
SIGNATURE_H = 95


def _format_item_row(idx, item):
    """Format a single item into a table row."""
    concept = safe(item, 'concept', '')
    if len(concept) > 45:
        concept = concept[:42] + "..."
    desc = safe(item, 'description', '')
    if desc:
        if len(desc) > 55:
            desc = desc[:52] + "..."
        concept = concept + "\n" + desc
    return [
        str(idx),
        concept,
        safe(item, 'unit', 'ud'),
        f"{float(item.get('quantity') or 0):.2f}",
        f"{float(item.get('unit_price') or 0):.2f}",
        f"{float(item.get('subtotal') or 0):.2f}",
    ]


def draw_partida_pages(c, budget, company, chapter_name, chapter_items, chapter_idx, total_chapters):
    """Draw chapter pages, splitting across multiple pages if needed. Returns number of pages used."""
    ch_subtotal = sum(float(i.get('subtotal') or 0) for i in chapter_items)
    pages_used = 0

    # Build all item rows
    all_rows = []
    for idx, item in enumerate(chapter_items, 1):
        all_rows.append(_format_item_row(idx, item))

    # Split rows into page-sized chunks
    row_idx = 0
    is_first_page = True

    while row_idx < len(all_rows):
        global _page_counter
        if pages_used > 0:
            # Increment page counter for continuation pages
            _page_counter = [_page_counter[0] + 1, _page_counter[1]]
        draw_header(c, budget, company)
        draw_footer(c, company)

        y = TOP_Y

        # Chapter header (on every page of this chapter)
        c.setFillColor(BRAND_GREEN)
        c.rect(15*mm, y - 2, 4, 18, fill=1, stroke=0)

        c.setFont("Helvetica-Bold", 14)
        c.setFillColor(NAVY_900)
        if is_first_page:
            c.drawString(22*mm, y + 6, f"{chapter_idx}. {chapter_name}")
        else:
            c.drawString(22*mm, y + 6, f"{chapter_idx}. {chapter_name} (cont.)")

        c.setFont("Helvetica", 9)
        c.setFillColor(NAVY_500)
        c.drawString(22*mm, y - 8, f"Partida {chapter_idx} de {total_chapters}")

        y -= TITLE_BLOCK_H

        # Calculate available space for this page
        available_h = y - BOTTOM_Y

        # Determine how many rows fit on this page
        # Build table incrementally to measure
        rows_this_page = []
        remaining = len(all_rows) - row_idx
        is_last_chunk = False

        for i in range(remaining):
            test_rows = [HEADER_ROW] + rows_this_page + [all_rows[row_idx + i]]
            # Check if this is the last row — if so, add subtotal
            is_potentially_last = (row_idx + i + 1 >= len(all_rows))
            if is_potentially_last:
                test_rows.append(["", f"Subtotal {chapter_name}", "", "", "", f"{ch_subtotal:.2f}"])

            t = Table(test_rows, colWidths=COL_WIDTHS)
            t.setStyle(_build_table_style(len(test_rows), is_subtotal_row=is_potentially_last))
            tw, th = t.wrap(W - 30*mm, available_h)

            # Reserve space for signatures on the last chunk
            min_bottom = SIGNATURE_H if is_potentially_last else 10
            if th > available_h - min_bottom and len(rows_this_page) > 0:
                # This row doesn't fit, stop here
                break
            rows_this_page.append(all_rows[row_idx + i])
            if is_potentially_last:
                is_last_chunk = True

        if len(rows_this_page) == 0:
            # Single row too tall — force it anyway
            rows_this_page.append(all_rows[row_idx])
            is_last_chunk = (row_idx + 1 >= len(all_rows))

        # Build final table for this page
        table_data = [HEADER_ROW] + rows_this_page
        if is_last_chunk:
            table_data.append(["", f"Subtotal {chapter_name}", "", "", "", f"{ch_subtotal:.2f}"])

        t = Table(table_data, colWidths=COL_WIDTHS)
        t.setStyle(_build_table_style(len(table_data), is_subtotal_row=is_last_chunk))
        tw, th = t.wrap(W - 30*mm, available_h)
        t.drawOn(c, 15*mm, y - th)

        # Signature blocks on the last page of this chapter
        if is_last_chunk:
            sig_y = y - th - 15
            if sig_y > BOTTOM_Y + SIGNATURE_H:
                draw_signature_blocks(c, BOTTOM_Y + SIGNATURE_H - 10, company, safe(budget, 'client_name', ''))

        row_idx += len(rows_this_page)
        pages_used += 1
        is_first_page = False

        if row_idx < len(all_rows):
            c.showPage()

    return pages_used


def draw_totals_page(c, budget, company, items, page_num, total_pages):
    """Final summary page with totals and signatures."""
    draw_header(c, budget, company, page_num, total_pages)
    draw_footer(c, company)

    y = H - 50*mm

    # Title
    c.setFont("Helvetica-Bold", 16)
    c.setFillColor(NAVY_900)
    c.drawString(15*mm, y, "RESUMEN GENERAL DEL PRESUPUESTO")
    y -= 8
    c.setStrokeColor(BRAND_GREEN)
    c.setLineWidth(2)
    c.line(15*mm, y, 100*mm, y)
    y -= 20

    # Group by chapter and show subtotals
    chapters = {}
    for item in items:
        ch = safe(item, 'chapter') or safe(item, 'category', 'General') or 'General'
        if ch not in chapters:
            chapters[ch] = []
        chapters[ch].append(item)

    table_data = [["Partida", "Importe"]]
    for ch_name, ch_items in chapters.items():
        ch_total = sum(float(i.get('subtotal') or 0) for i in ch_items)
        table_data.append([ch_name, f"{ch_total:.2f} EUR"])

    col_widths = [120*mm, 40*mm]
    t = Table(table_data, colWidths=col_widths)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), NAVY_900),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 9),
        ('TEXTCOLOR', (0, 1), (-1, -1), NAVY_700),
        ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
        ('GRID', (0, 0), (-1, -1), 0.5, NAVY_200),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, GRAY_50]),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))

    tw, th = t.wrap(W - 30*mm, 200)
    t.drawOn(c, 15*mm, y - th)
    y = y - th - 15

    # Totals box
    subtotal = float(budget.get('subtotal') or 0)
    iva_pct = float(budget.get('iva_percent') or 21)
    iva_amount = float(budget.get('iva_amount') or 0)
    total = float(budget.get('total') or 0)

    box_x = W - 15*mm - 80*mm
    box_w = 80*mm

    c.setFillColor(GRAY_50)
    c.roundRect(box_x, y - 65, box_w, 60, 4, fill=1, stroke=0)
    c.setStrokeColor(BRAND_GREEN)
    c.setLineWidth(1.5)
    c.line(box_x, y - 5, box_x + box_w, y - 5)

    c.setFont("Helvetica", 10)
    c.setFillColor(NAVY_500)
    c.drawString(box_x + 5, y - 20, "Subtotal")
    c.drawRightString(box_x + box_w - 5, y - 20, fmt(subtotal))

    c.drawString(box_x + 5, y - 35, f"IVA ({iva_pct}%)")
    c.drawRightString(box_x + box_w - 5, y - 35, fmt(iva_amount))

    c.setStrokeColor(NAVY_200)
    c.setLineWidth(0.5)
    c.line(box_x + 5, y - 42, box_x + box_w - 5, y - 42)

    c.setFont("Helvetica-Bold", 14)
    c.setFillColor(BRAND_GREEN)
    c.drawString(box_x + 5, y - 58, "TOTAL")
    c.drawRightString(box_x + box_w - 5, y - 58, fmt(total))

    y = y - 85

    # Notes
    notes = safe(budget, 'notes', '')
    if notes:
        c.setFont("Helvetica-Bold", 10)
        c.setFillColor(NAVY_900)
        c.drawString(15*mm, y, "NOTAS Y CONDICIONES")
        y -= 5
        c.setStrokeColor(BRAND_GREEN)
        c.setLineWidth(1)
        c.line(15*mm, y, 70*mm, y)
        y -= 12

        c.setFont("Helvetica", 8)
        c.setFillColor(NAVY_500)
        # Simple word wrap
        words = notes.split()
        line = ""
        max_width = W - 30*mm
        for word in words:
            test = line + " " + word if line else word
            if c.stringWidth(test, "Helvetica", 8) < max_width:
                line = test
            else:
                c.drawString(15*mm, y, line)
                y -= 11
                line = word
                if y < 100:
                    break
        if line:
            c.drawString(15*mm, y, line)
            y -= 11

    # Signature blocks
    sig_y = min(y - 10, 50*mm + 65)
    if sig_y > 40*mm:
        draw_signature_blocks(c, sig_y, company, safe(budget, 'client_name', ''))


def generate_pdf(data, output_path):
    """Main entry point."""
    budget = data.get('budget', {})
    items = data.get('items', [])
    company = data.get('company', {})

    # Format dates
    if safe(budget, 'created_at'):
        try:
            dt = datetime.fromisoformat(budget['created_at'].replace('Z', '+00:00'))
            budget['date'] = dt.strftime('%d/%m/%Y')
        except:
            budget['date'] = safe(budget, 'created_at', '')[:10]
    else:
        budget['date'] = datetime.now().strftime('%d/%m/%Y')

    if safe(budget, 'valid_until'):
        try:
            dt = datetime.fromisoformat(budget['valid_until'].replace('Z', '+00:00'))
            budget['valid_until'] = dt.strftime('%d/%m/%Y')
        except:
            pass

    # Group items by chapter/category
    chapters = {}
    for item in items:
        ch = safe(item, 'chapter') or safe(item, 'category', 'General') or 'General'
        # Map category codes to readable names
        ch_labels = {
            'material': 'Material',
            'mano_obra': 'Mano de obra',
            'maquinaria': 'Maquinaria',
            'otros': 'Otros',
        }
        ch_display = ch_labels.get(ch, ch.replace('_', ' ').title())
        if ch_display not in chapters:
            chapters[ch_display] = []
        chapters[ch_display].append(item)

    if not chapters:
        chapters = {'General': items}

    global _page_counter

    # --- Pass 1: count pages by doing a dry run into a temp buffer ---
    import io
    buf = io.BytesIO()
    tmp_c = canvas.Canvas(buf, pagesize=A4)
    page_count = 1  # cover
    draw_cover_page(tmp_c, budget, company, items)
    tmp_c.showPage()
    for ch_idx, (ch_name, ch_items) in enumerate(chapters.items(), 1):
        _page_counter = [0, 0]
        pages = draw_partida_pages(tmp_c, budget, company, ch_name, ch_items, ch_idx, len(chapters))
        page_count += pages
        tmp_c.showPage()
    page_count += 1  # totals page
    del tmp_c, buf

    # --- Pass 2: generate the actual PDF with correct page numbers ---
    c = canvas.Canvas(output_path, pagesize=A4)
    c.setTitle(f"Presupuesto {safe(budget, 'budget_number', '')}")
    c.setAuthor(safe(company, 'name', 'Enlaze'))
    c.setSubject(safe(budget, 'title', 'Presupuesto'))

    # Page 1: Cover (page_counter = 0 so no page number shown)
    _page_counter = [0, page_count]
    draw_cover_page(c, budget, company, items)
    c.showPage()

    # Pages 2..N: One or more pages per chapter
    current_page = 1
    for ch_idx, (ch_name, ch_items) in enumerate(chapters.items(), 1):
        _page_counter = [current_page + 1, page_count]
        pages = draw_partida_pages(c, budget, company, ch_name, ch_items, ch_idx, len(chapters))
        current_page += pages
        c.showPage()

    # Last page: Totals + Signatures
    _page_counter = [page_count, page_count]
    draw_totals_page(c, budget, company, items, page_count, page_count)
    c.showPage()

    c.save()


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: generate-budget-pdf.py <input.json> <output.pdf>", file=sys.stderr)
        sys.exit(1)

    with open(sys.argv[1], 'r') as f:
        data = json.load(f)

    generate_pdf(data, sys.argv[2])
    print(json.dumps({"success": True, "path": sys.argv[2]}))
