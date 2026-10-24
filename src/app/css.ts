// Reads a design token (spec 11b.3) from the root custom properties.
export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
