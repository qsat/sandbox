export function splitKeys(input: string) {
  return input.match(/\x1b\[[0-9;]*[A-Za-z~]|\x1bO[A-Za-z]|[\s\S]/g) ?? [];
}
