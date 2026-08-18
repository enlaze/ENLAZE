export interface ProductIdentity {
  name: string;
  sku?: string | null;
}

/**
 * Claim both stable identities before adding a product to a bulk upsert.
 * PostgreSQL cannot update the same unique row twice in one INSERT statement.
 */
export function claimUniqueProduct(
  claimedKeys: Set<string>,
  product: ProductIdentity
): boolean {
  const keys = [`name:${product.name.trim().toLocaleLowerCase("es")}`];
  const sku = product.sku?.trim();
  if (sku) keys.push(`sku:${sku}`);

  if (keys.some((key) => claimedKeys.has(key))) return false;
  for (const key of keys) claimedKeys.add(key);
  return true;
}
