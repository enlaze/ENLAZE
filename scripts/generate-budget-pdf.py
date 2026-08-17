#!/usr/bin/env python3
"""
Presupix-format Budget PDF Generator for ENLAZE

Mirrors the "cliente" HTML layout produced by lib/pdf-generator.ts
(renderPresupixClientHTML) as a single continuous A4 document:
  - Header (company data + PRESUPUESTO title/N.o/Fecha/Validez) on page 1
  - CLIENTE block
  - Item table (Nº | Descripción | Cantidad | Ud | Precio unit. | Total),
    grouped into one section per chapter (or a single section named after
    the budget title when there is only one chapter)
  - Subtotal / Descuento / Base imponible / IVA / TOTAL breakdown box
    (Descuento row only shown when the budget has a discount applied)
  - Notas, Método de cobro, Forma de pago (payment_schedule if defined,
    otherwise the classic anticipo + resto fallback)
  - TOTAL repetido
  - Plazo de ejecución / Garantía / Observaciones / Condiciones
  - Firmas (empresa + cliente)

Uses a two-pass render (dry run to count pages, then the real render) so the
footer can show "Página X de N" correctly, same technique as before.
"""

import json
import sys
import io
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white
from reportlab.pdfgen import canvas
from reportlab.platypus import Table, TableStyle
from reportlab.lib.utils import ImageReader
from datetime import datetime

# ── Colors ──────────────────────────────────────────────────────────────────
BRAND_GREEN = HexColor("#00c896")
NAVY_900 = HexColor("#0a1628")
NAVY_700 = HexColor("#1e3a5f")
NAVY_500 = HexColor("#475569")
NAVY_200 = HexColor("#cbd5e1")
GRAY_50 = HexColor("#f8fafc")
GRAY_100 = HexColor("#f1f5f9")
DISCOUNT_RED = HexColor("#b91c1c")
WHITE = white

W, H = A4  # 210mm x 297mm

LEFT_X = 15 * mm
RIGHT_X = W - 15 * mm
CONTENT_W = W - 30 * mm
BOTTOM_MARGIN = 25 * mm

HEADER_ROW = ["Nº", "Descripción", "Cantidad", "Ud", "Precio unit.", "Total"]
COL_WIDTHS = [10 * mm, 77 * mm, 20 * mm, 15 * mm, 26 * mm, 32 * mm]

UNIT_LABELS = {"ud": "ud", "m2": "m²", "ml": "ml", "h": "h", "kg": "kg", "global": "global"}

CHAPTER_FALLBACK_LABELS = {
    "fontaneria": "Fontanería",
    "electricidad": "Electricidad",
    "albanileria": "Albañilería",
    "pintura": "Pintura",
    "carpinteria": "Carpintería",
    "climatizacion": "Climatización",
    "reforma": "Reforma integral",
    "multiservicios": "Multiservicios",
    "material": "Material",
    "mano_obra": "Mano de obra",
    "maquinaria": "Maquinaria",
    "otros": "Otros",
    "general": "General",
}


def safe(d, key, default=""):
    """Get value from dict, returning default if key is missing or value is None."""
    v = d.get(key, default)
    return v if v is not None else default


def fmt_num(n):
    """Format a number as '1.234,56' (Spanish thousands/decimal separators)."""
    if n is None:
        n = 0
    return f"{n:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def fmt(n):
    """Format a number as currency, e.g. '1.234,56 €'."""
    return fmt_num(n) + " €"


def unit_label(u):
    return UNIT_LABELS.get(u, u or "ud")


def wrap_text(c, text, font, size, max_width):
    words = text.split()
    lines = []
    line = ""
    for w in words:
        test = (line + " " + w).strip()
        if not line or c.stringWidth(test, font, size) <= max_width:
            line = test
        else:
            lines.append(line)
            line = w
    if line:
        lines.append(line)
    return lines or [""]


def wrap_multiline(c, text, font, size, max_width):
    lines = []
    for para in str(text).split("\n"):
        if para.strip() == "":
            lines.append("")
            continue
        lines.extend(wrap_text(c, para, font, size, max_width))
    return lines


def draw_company_logo(c, company, x, y, max_w, max_h):
    """Draw the uploaded company logo while preserving its aspect ratio."""
    logo_path = safe(company, "logo_path")
    if not logo_path:
        return False
    try:
        image = ImageReader(logo_path)
        width, height = image.getSize()
        if not width or not height:
            return False
        scale = min(max_w / width, max_h / height)
        draw_w = width * scale
        draw_h = height * scale
        c.drawImage(
            image,
            x,
            y + (max_h - draw_h) / 2,
            width=draw_w,
            height=draw_h,
            preserveAspectRatio=True,
            mask="auto",
        )
        return True
    except Exception:
        return False


def draw_signature_blocks(c, y, company, client_name):
    """Draw dual signature blocks (company + client)."""
    block_w = 75 * mm
    left_x = LEFT_X
    right_x = RIGHT_X - block_w

    c.setFont("Helvetica-Bold", 9)
    c.setFillColor(NAVY_900)
    c.drawString(left_x, y, "Firma del profesional:")
    c.setFont("Helvetica", 8)
    c.setFillColor(NAVY_500)
    c.drawString(left_x, y - 14, safe(company, "name", ""))
    if safe(company, "nif"):
        c.drawString(left_x, y - 26, f"NIF: {company['nif']}")

    c.setStrokeColor(NAVY_200)
    c.setLineWidth(0.5)
    c.line(left_x, y - 55, left_x + block_w, y - 55)
    c.setFont("Helvetica", 7)
    c.setFillColor(NAVY_500)
    c.drawString(left_x, y - 63, "Firma y sello")

    c.setFont("Helvetica-Bold", 9)
    c.setFillColor(NAVY_900)
    c.drawString(right_x, y, "Firma del cliente:")
    c.setFont("Helvetica", 8)
    c.setFillColor(NAVY_500)
    c.drawString(right_x, y - 14, client_name or "")

    c.line(right_x, y - 55, right_x + block_w, y - 55)
    c.setFont("Helvetica", 7)
    c.setFillColor(NAVY_500)
    c.drawString(right_x, y - 63, "Firma del cliente")

    c.setFont("Helvetica", 8)
    c.setFillColor(NAVY_500)
    c.drawString(left_x, y - 80, f"En _________________, a ______ de _________________ de {datetime.now().year}")


def draw_footer_line(c, company, page_num, total_pages):
    c.setStrokeColor(NAVY_200)
    c.setLineWidth(0.5)
    c.line(LEFT_X, 15 * mm, RIGHT_X, 15 * mm)
    c.setFont("Helvetica", 7)
    c.setFillColor(NAVY_500)
    c.drawString(LEFT_X, 10 * mm, f"{safe(company, 'name', '')} · Presupuesto generado con Enlaze")
    if total_pages:
        c.drawRightString(RIGHT_X, 10 * mm, f"Página {page_num} de {total_pages}")


def build_sections(budget, items):
    """Group items into Presupix sections, mirroring buildPresupixSections()
    in lib/pdf-generator.ts: a single section named after the budget title
    when there's zero or one distinct chapter, otherwise one section per
    chapter (+ 'Otros' for items without a chapter)."""
    chapters = {}
    order = []
    for item in items:
        ch = safe(item, "chapter")
        if ch:
            if ch not in chapters:
                chapters[ch] = []
                order.append(ch)
            chapters[ch].append(item)

    if len(order) <= 1:
        return [{"label": safe(budget, "title", "Presupuesto"), "items": items}]

    sections = []
    for ch in order:
        label = CHAPTER_FALLBACK_LABELS.get(ch, ch.replace("_", " ").strip().capitalize())
        sections.append({"label": label, "items": chapters[ch]})

    unassigned = [i for i in items if not safe(i, "chapter")]
    if unassigned:
        sections.append({"label": "Otros", "items": unassigned})

    return sections


def _format_item_row(idx, item):
    concept = safe(item, "concept", "")
    if len(concept) > 48:
        concept = concept[:45] + "..."
    desc = safe(item, "description", "")
    if desc:
        if len(desc) > 60:
            desc = desc[:57] + "..."
        concept = concept + "\n" + desc
    qty = float(item.get("quantity") or 0)
    price = float(item.get("unit_price") or 0)
    subtotal = float(item.get("subtotal") or 0)
    return [str(idx), concept, f"{qty:.2f}", unit_label(safe(item, "unit", "ud")), fmt(price), fmt(subtotal)]


def _entry_to_row(entry):
    kind = entry[0]
    if kind == "section":
        return [entry[1], "", "", "", "", ""]
    if kind == "subtotal":
        return [f"Subtotal · {entry[1]}", "", "", "", "", fmt(entry[2])]
    return entry[1]  # 'item' -> already a formatted row


def _style_for_chunk(rows_meta):
    cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY_900),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("ALIGN", (2, 0), (3, -1), "CENTER"),
        ("ALIGN", (4, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.5, NAVY_200),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]
    for i, meta in enumerate(rows_meta, start=1):  # row 0 is HEADER_ROW
        kind = meta[0]
        if kind == "section":
            cmds += [
                ("SPAN", (0, i), (-1, i)),
                ("BACKGROUND", (0, i), (-1, i), GRAY_100),
                ("FONTNAME", (0, i), (-1, i), "Helvetica-Bold"),
                ("FONTSIZE", (0, i), (-1, i), 9),
                ("TEXTCOLOR", (0, i), (-1, i), NAVY_900),
                ("ALIGN", (0, i), (-1, i), "LEFT"),
            ]
        elif kind == "subtotal":
            cmds += [
                ("SPAN", (0, i), (4, i)),
                ("BACKGROUND", (0, i), (-1, i), GRAY_100),
                ("FONTNAME", (0, i), (-1, i), "Helvetica-Bold"),
                ("FONTSIZE", (0, i), (-1, i), 8.5),
                ("TEXTCOLOR", (0, i), (-1, i), NAVY_900),
                ("ALIGN", (0, i), (4, i), "RIGHT"),
            ]
        else:
            cmds += [
                ("FONTNAME", (0, i), (-1, i), "Helvetica"),
                ("FONTSIZE", (0, i), (-1, i), 8),
                ("TEXTCOLOR", (0, i), (-1, i), NAVY_700),
            ]
    return TableStyle(cmds)


class DocBuilder:
    """Flows Presupix-format content across as many A4 pages as needed."""

    def __init__(self, canvas_obj, budget, company, items, total_pages=0):
        self.c = canvas_obj
        self.budget = budget
        self.company = company
        self.items = items
        self.page_num = 0
        self.total_pages = total_pages
        self.y = 0

    # ── page management ──────────────────────────────────────────────────
    def new_page(self, first=False):
        if self.page_num > 0:
            self.draw_footer()
            self.c.showPage()
        self.page_num += 1
        if first:
            self.y = self.draw_full_header()
        else:
            self.y = self.draw_compact_header()

    def ensure_space(self, needed):
        if self.y - needed < BOTTOM_MARGIN:
            self.new_page()

    def draw_footer(self):
        draw_footer_line(self.c, self.company, self.page_num, self.total_pages)

    # ── header / client block ────────────────────────────────────────────
    def draw_full_header(self):
        c, budget, company = self.c, self.budget, self.company
        top = H - 15 * mm

        logo_drawn = draw_company_logo(c, company, LEFT_X, top - 22 * mm, 50 * mm, 20 * mm)
        if not logo_drawn:
            c.setFont("Helvetica-Bold", 15)
            c.setFillColor(NAVY_900)
            c.drawString(LEFT_X, top - 6 * mm, safe(company, "name", "Mi Empresa")[:40])
            info_y = top - 13 * mm
        else:
            info_y = top - 25 * mm

        c.setFont("Helvetica", 8)
        c.setFillColor(NAVY_500)
        info_lines = []
        if safe(company, "nif"):
            info_lines.append(f"NIF/CIF: {company['nif']}")
        if safe(company, "address"):
            info_lines.append(company["address"])
        phone_email = " · ".join(
            filter(None, [f"Tel: {company['phone']}" if safe(company, "phone") else "", safe(company, "email")])
        )
        if phone_email:
            info_lines.append(phone_email)
        for line in info_lines:
            c.drawString(LEFT_X, info_y, line[:95])
            info_y -= 4.2 * mm

        c.setFont("Helvetica-Bold", 20)
        c.setFillColor(NAVY_900)
        c.drawRightString(RIGHT_X, top - 6 * mm, "PRESUPUESTO")

        c.setFont("Helvetica", 9)
        c.setFillColor(NAVY_500)
        meta_y = top - 14 * mm
        c.drawRightString(RIGHT_X, meta_y, f"N.º: {safe(budget, 'budget_number', '')}")
        meta_y -= 4.5 * mm
        c.drawRightString(RIGHT_X, meta_y, f"Fecha: {safe(budget, 'date', '')}")
        if safe(budget, "valid_until"):
            meta_y -= 4.5 * mm
            c.drawRightString(RIGHT_X, meta_y, f"Validez: {budget['valid_until']}")

        header_bottom = min(info_y, meta_y) - 4 * mm
        c.setStrokeColor(NAVY_200)
        c.setLineWidth(0.75)
        c.line(LEFT_X, header_bottom, RIGHT_X, header_bottom)

        return self.draw_client_block(header_bottom - 10 * mm)

    def draw_client_block(self, y):
        c, budget = self.c, self.budget
        c.setFont("Helvetica-Bold", 8)
        c.setFillColor(BRAND_GREEN)
        c.drawString(LEFT_X, y, "CLIENTE")
        y -= 5 * mm
        c.setFont("Helvetica-Bold", 10)
        c.setFillColor(NAVY_900)
        c.drawString(LEFT_X, y, safe(budget, "client_name", "Sin cliente")[:60])
        y -= 4.5 * mm
        c.setFont("Helvetica", 8)
        c.setFillColor(NAVY_500)
        parts = []
        if safe(budget, "client_nif"):
            parts.append(f"NIF: {budget['client_nif']}")
        if safe(budget, "client_address"):
            parts.append(budget["client_address"])
        if parts:
            c.drawString(LEFT_X, y, " · ".join(parts)[:110])
            y -= 4.2 * mm
        contact = " · ".join(filter(None, [safe(budget, "client_phone"), safe(budget, "client_email")]))
        if contact:
            c.drawString(LEFT_X, y, contact[:110])
            y -= 4.2 * mm
        return y - 5 * mm

    def draw_compact_header(self):
        c, budget, company = self.c, self.budget, self.company
        top = H - 15 * mm
        c.setFont("Helvetica-Bold", 11)
        c.setFillColor(NAVY_900)
        c.drawString(LEFT_X, top - 4 * mm, safe(company, "name", "")[:50])
        c.setFont("Helvetica", 8)
        c.setFillColor(NAVY_500)
        title = safe(budget, "title", "")
        if len(title) > 40:
            title = title[:37] + "..."
        c.drawRightString(RIGHT_X, top - 4 * mm, f"{safe(budget, 'budget_number', '')} · {title}")
        y = top - 9 * mm
        c.setStrokeColor(NAVY_200)
        c.setLineWidth(0.5)
        c.line(LEFT_X, y, RIGHT_X, y)
        return y - 8 * mm

    # ── item table ────────────────────────────────────────────────────────
    def draw_items(self):
        sections = build_sections(self.budget, self.items)
        show_section_header = len(sections) > 1

        flat_rows = []
        for section in sections:
            if show_section_header:
                flat_rows.append(("section", section["label"]))
            for idx, item in enumerate(section["items"], 1):
                flat_rows.append(("item", _format_item_row(idx, item)))
            subtotal = sum(float(i.get("subtotal") or 0) for i in section["items"])
            flat_rows.append(("subtotal", section["label"], subtotal))

        row_idx = 0
        while row_idx < len(flat_rows):
            available_h = self.y - BOTTOM_MARGIN
            rows_this_page = []
            i = 0
            while row_idx + i < len(flat_rows):
                candidate = flat_rows[row_idx + i]
                test_meta = rows_this_page + [candidate]
                test_table = [HEADER_ROW] + [_entry_to_row(e) for e in test_meta]
                t = Table(test_table, colWidths=COL_WIDTHS)
                t.setStyle(_style_for_chunk(test_meta))
                _, th = t.wrap(CONTENT_W, available_h)
                if th > available_h and len(rows_this_page) > 0:
                    break
                rows_this_page.append(candidate)
                i += 1
                if th > available_h:
                    # Forced a single oversized row onto the page; stop here.
                    break

            if not rows_this_page:
                rows_this_page = [flat_rows[row_idx]]
                i = 1

            table_data = [HEADER_ROW] + [_entry_to_row(e) for e in rows_this_page]
            t = Table(table_data, colWidths=COL_WIDTHS)
            t.setStyle(_style_for_chunk(rows_this_page))
            _, th = t.wrap(CONTENT_W, available_h)
            t.drawOn(self.c, LEFT_X, self.y - th)
            self.y -= th + 4 * mm

            row_idx += i
            if row_idx < len(flat_rows):
                self.new_page()

    # ── breakdown / notas / cobro / forma de pago / total / firmas ─────────
    def draw_breakdown(self):
        c, budget = self.c, self.budget
        subtotal = float(budget.get("subtotal") or 0)
        iva_pct = float(budget.get("iva_percent") or 21)
        iva_amount = float(budget.get("iva_amount") or 0)
        total = float(budget.get("total") or 0)
        deposit_pct = float(budget.get("deposit_percent") or 30)
        deposit_amount = round(total * deposit_pct / 100, 2)
        pending_amount = round(total - deposit_amount, 2)

        # Descuento: aplica sobre el subtotal (base imponible) antes del IVA.
        discount_type = budget.get("discount_type") or "percent"
        discount_pct = float(budget.get("discount_percent") or 0)
        discount_amount_input = float(budget.get("discount_amount") or 0)
        if discount_type == "amount":
            discount_value = min(subtotal, max(0.0, discount_amount_input))
        else:
            discount_pct = max(0.0, min(100.0, discount_pct))
            discount_value = round(subtotal * discount_pct / 100, 2)
        taxable_base = max(0.0, subtotal - discount_value)
        has_discount = discount_value > 0

        # Fases de pago: usa el calendario del presupuesto, o cae al
        # comportamiento clásico (anticipo/resto) para presupuestos antiguos.
        payment_schedule = budget.get("payment_schedule") or []
        has_schedule = isinstance(payment_schedule, list) and len(payment_schedule) > 0

        box_w = 85 * mm
        box_x = RIGHT_X - box_w
        box_h = 44 * mm + (14 * mm if has_discount else 0)
        self.ensure_space(box_h + 14 * mm)
        y = self.y

        c.setFillColor(GRAY_50)
        c.roundRect(box_x, y - box_h - 4 * mm, box_w, box_h, 4, fill=1, stroke=0)
        c.setStrokeColor(BRAND_GREEN)
        c.setLineWidth(1.5)
        c.line(box_x, y - 4 * mm, box_x + box_w, y - 4 * mm)

        ty = y - 12 * mm
        c.setFont("Helvetica", 9)
        if has_discount:
            c.setFillColor(NAVY_500)
            c.drawString(box_x + 5, ty, "Subtotal")
            c.drawRightString(box_x + box_w - 5, ty, fmt(subtotal))
            ty -= 7 * mm
            c.setFillColor(DISCOUNT_RED)
            discount_label = "Descuento" + (f" ({discount_pct:.0f}%)" if discount_type != "amount" else "")
            c.drawString(box_x + 5, ty, discount_label)
            c.drawRightString(box_x + box_w - 5, ty, f"-{fmt(discount_value)}")
            ty -= 7 * mm
            c.setFillColor(NAVY_500)
            c.drawString(box_x + 5, ty, "Base imponible")
            c.drawRightString(box_x + box_w - 5, ty, fmt(taxable_base))
        else:
            c.setFillColor(NAVY_500)
            c.drawString(box_x + 5, ty, "Base imponible")
            c.drawRightString(box_x + box_w - 5, ty, fmt(subtotal))
        ty -= 7 * mm
        c.setFillColor(NAVY_500)
        c.drawString(box_x + 5, ty, f"IVA ({iva_pct:.0f}%)")
        c.drawRightString(box_x + box_w - 5, ty, fmt(iva_amount))
        ty -= 8 * mm
        c.setFont("Helvetica-Bold", 12)
        c.setFillColor(BRAND_GREEN)
        c.drawString(box_x + 5, ty, "TOTAL")
        c.drawRightString(box_x + box_w - 5, ty, fmt(total))
        if not has_schedule:
            ty -= 8 * mm
            c.setFont("Helvetica", 8)
            c.setFillColor(NAVY_500)
            c.drawString(box_x + 5, ty, f"Anticipo ({deposit_pct:.0f}%)")
            c.drawRightString(box_x + box_w - 5, ty, fmt(deposit_amount))
            ty -= 6 * mm
            c.drawString(box_x + 5, ty, "Pendiente")
            c.drawRightString(box_x + box_w - 5, ty, fmt(pending_amount))

        self.y = y - box_h - 4 * mm - 10 * mm
        return deposit_pct, deposit_amount, pending_amount

    def draw_text_block(self, label, text):
        if not text:
            return
        c = self.c
        lines = wrap_multiline(c, text, "Helvetica", 8.5, CONTENT_W)
        needed = 10 * mm + len(lines) * 4.2 * mm + 4 * mm
        self.ensure_space(needed)
        y = self.y
        c.setFont("Helvetica-Bold", 8)
        c.setFillColor(BRAND_GREEN)
        c.drawString(LEFT_X, y, label.upper())
        y -= 5.5 * mm
        c.setFont("Helvetica", 8.5)
        c.setFillColor(NAVY_700)
        for line in lines:
            c.drawString(LEFT_X, y, line)
            y -= 4.2 * mm
        self.y = y - 4 * mm

    def draw_cobro(self):
        budget = self.budget
        parts = []
        if safe(budget, "payment_method"):
            parts.append(f"Forma de pago: {budget['payment_method']}")
        if safe(budget, "payment_iban"):
            parts.append(f"IBAN: {budget['payment_iban']}")
        if not parts:
            return
        self.draw_text_block("Método de cobro", "\n".join(parts))

    def draw_forma_pago(self, deposit_pct, deposit_amount, pending_amount):
        budget = self.budget
        total = float(budget.get("total") or 0)
        payment_schedule = budget.get("payment_schedule") or []

        if isinstance(payment_schedule, list) and len(payment_schedule) > 0:
            rows = []
            for phase in payment_schedule:
                pct = max(0.0, min(100.0, float(phase.get("percent") or 0)))
                amount = round(total * pct / 100, 2)
                concept = phase.get("concept") or "Pago"
                moment = phase.get("moment") or ""
                title = f"{concept} {pct:.0f}%" if pct else concept
                rows.append((title, f"Momento: {moment}" if moment else "", amount))
        else:
            rows = [
                (f"Anticipo {deposit_pct:.0f}%", "Momento: Al aceptar · Reserva de fecha e inicio de trabajos.", deposit_amount),
                ("Pago a la finalización (resto)", "Momento: A la entrega de la obra · Salvo acuerdo por fases.", pending_amount),
            ]

        self.ensure_space(10 * mm + len(rows) * 11.5 * mm)
        c = self.c
        y = self.y
        c.setFont("Helvetica-Bold", 8)
        c.setFillColor(BRAND_GREEN)
        c.drawString(LEFT_X, y, "FORMA DE PAGO")
        y -= 7 * mm

        for title, moment, amount in rows:
            c.setFont("Helvetica-Bold", 9)
            c.setFillColor(NAVY_900)
            c.drawString(LEFT_X, y, title)
            c.drawRightString(RIGHT_X, y, fmt(amount))
            y -= 4.5 * mm
            if moment:
                c.setFont("Helvetica", 7.5)
                c.setFillColor(NAVY_500)
                c.drawString(LEFT_X, y, moment)
            y -= 7 * mm

        self.y = y - 2 * mm

    def draw_total_repeat(self):
        self.ensure_space(16 * mm)
        c = self.c
        total = float(self.budget.get("total") or 0)
        y = self.y
        c.setStrokeColor(NAVY_200)
        c.setLineWidth(0.5)
        c.line(LEFT_X, y, RIGHT_X, y)
        y -= 8 * mm
        c.setFont("Helvetica-Bold", 12)
        c.setFillColor(NAVY_900)
        c.drawString(LEFT_X, y, "TOTAL PRESUPUESTO")
        c.setFillColor(BRAND_GREEN)
        c.drawRightString(RIGHT_X, y, fmt(total))
        self.y = y - 8 * mm

    def draw_signatures(self):
        self.ensure_space(95 * mm)
        draw_signature_blocks(self.c, self.y, self.company, safe(self.budget, "client_name", ""))
        self.y -= 95 * mm


def render_document(canvas_obj, budget, company, items, total_pages):
    b = DocBuilder(canvas_obj, budget, company, items, total_pages)
    b.new_page(first=True)
    b.draw_items()
    deposit_pct, deposit_amount, pending_amount = b.draw_breakdown()
    b.draw_text_block("Notas", safe(budget, "notes", ""))
    b.draw_cobro()
    b.draw_forma_pago(deposit_pct, deposit_amount, pending_amount)
    b.draw_total_repeat()
    b.draw_text_block("Plazo de ejecución", safe(budget, "execution_deadline_text", ""))
    b.draw_text_block("Garantía", safe(budget, "warranty_text", ""))
    b.draw_text_block("Observaciones", safe(budget, "observations", ""))
    b.draw_text_block("Condiciones", safe(budget, "conditions_text", ""))
    b.draw_signatures()
    b.draw_footer()
    canvas_obj.showPage()
    return b.page_num


def generate_pdf(data, output_path):
    """Main entry point."""
    budget = data.get("budget", {})
    items = data.get("items", [])
    company = data.get("company", {})

    if safe(budget, "created_at"):
        try:
            dt = datetime.fromisoformat(budget["created_at"].replace("Z", "+00:00"))
            budget["date"] = dt.strftime("%d/%m/%Y")
        except Exception:
            budget["date"] = safe(budget, "created_at", "")[:10]
    else:
        budget["date"] = datetime.now().strftime("%d/%m/%Y")

    if safe(budget, "valid_until"):
        try:
            dt = datetime.fromisoformat(budget["valid_until"].replace("Z", "+00:00"))
            budget["valid_until"] = dt.strftime("%d/%m/%Y")
        except Exception:
            pass

    # --- Pass 1: dry run into an in-memory buffer to count total pages ---
    buf = io.BytesIO()
    tmp_c = canvas.Canvas(buf, pagesize=A4)
    total_pages = render_document(tmp_c, dict(budget), company, items, total_pages=0)
    del tmp_c, buf

    # --- Pass 2: real render with the correct page count in the footer ---
    c = canvas.Canvas(output_path, pagesize=A4)
    c.setTitle(f"Presupuesto {safe(budget, 'budget_number', '')}")
    c.setAuthor(safe(company, "name", "Enlaze"))
    c.setSubject(safe(budget, "title", "Presupuesto"))
    render_document(c, budget, company, items, total_pages=total_pages)
    c.save()


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: generate-budget-pdf.py <input.json> <output.pdf>", file=sys.stderr)
        sys.exit(1)

    with open(sys.argv[1], "r") as f:
        data = json.load(f)

    generate_pdf(data, sys.argv[2])
    print(json.dumps({"success": True, "path": sys.argv[2]}))
