const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

export function isUlid(value: string): boolean {
  return ULID_PATTERN.test(value);
}

export function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const point = character.codePointAt(0);
    return point !== undefined && (point <= 0x1f || (point >= 0x7f && point <= 0x9f));
  });
}
