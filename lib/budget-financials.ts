export function calculateBudgetFinancials(
  subtotal: number,
  ivaPercent: number,
  discountType: "percent" | "amount",
  discountPercent: number,
  discountAmount: number,
) {
  const safeSubtotal = Math.max(0, Number(subtotal) || 0);
  const discountValue = discountType === "amount"
    ? Math.min(safeSubtotal, Math.max(0, Number(discountAmount) || 0))
    : Math.round(
        safeSubtotal * (Math.max(0, Math.min(100, Number(discountPercent) || 0)) / 100) * 100,
      ) / 100;
  const taxableBase = Math.max(0, safeSubtotal - discountValue);
  const ivaAmount = taxableBase * (Math.max(0, Number(ivaPercent) || 0) / 100);
  return {
    subtotal: safeSubtotal,
    discountValue,
    taxableBase,
    ivaAmount,
    total: taxableBase + ivaAmount,
  };
}
