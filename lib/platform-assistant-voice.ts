export interface AssistantVoiceCandidate {
  name: string;
  lang: string;
  default?: boolean;
  localService?: boolean;
}

const FEMALE_VOICE_HINTS = [
  "elvira",
  "monica",
  "marisol",
  "helena",
  "luciana",
  "paulina",
  "dalia",
  "ximena",
  "paloma",
  "isabela",
  "laura",
  "carmen",
  "conchita",
  "alba",
  "sofia",
  "maria",
  "sabina",
  "lupe",
  "esmeralda",
];

const MALE_VOICE_HINTS = [
  "jorge",
  "diego",
  "pablo",
  "carlos",
  "alvaro",
  "enrique",
  "raul",
  "miguel",
  "antonio",
  "juan",
  "pedro",
];

const NATURAL_VOICE_HINTS = [
  "natural",
  "neural",
  "premium",
  "enhanced",
  "siri",
  "online",
];

function normalized(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function voiceScore(voice: AssistantVoiceCandidate) {
  const name = normalized(voice.name);
  const language = normalized(voice.lang);
  let score = language === "es-es" ? 100 : 60;

  const femaleIndex = FEMALE_VOICE_HINTS.findIndex((hint) => name.includes(hint));
  if (femaleIndex >= 0) score += 420 - femaleIndex;
  if (NATURAL_VOICE_HINTS.some((hint) => name.includes(hint))) score += 220;
  if (name.includes("google espanol")) score += 100;
  if (MALE_VOICE_HINTS.some((hint) => name.includes(hint))) score -= 500;
  if (voice.localService) score += 20;
  if (voice.default) score += 5;

  return score;
}

export function selectPreferredSpanishFemaleVoice<T extends AssistantVoiceCandidate>(
  voices: readonly T[],
): T | null {
  const spanishVoices = voices.filter((voice) => normalized(voice.lang).startsWith("es"));
  if (spanishVoices.length === 0) return null;

  return [...spanishVoices].sort((left, right) => voiceScore(right) - voiceScore(left))[0] || null;
}
