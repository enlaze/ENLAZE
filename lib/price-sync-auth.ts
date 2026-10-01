export function bearerMatchesToken(
  authHeader: string,
  tokens: Array<string | undefined>,
) {
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  const validTokens = tokens.filter((token): token is string => Boolean(token));

  return Boolean(bearerToken && validTokens.includes(bearerToken));
}
