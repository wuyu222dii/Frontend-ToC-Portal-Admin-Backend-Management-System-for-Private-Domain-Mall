import { ApplicationError } from '@qingxu/platform-core';

export interface StoreSkuSpecification {
  attributes: Array<{ name: string; value: string }>;
}

function invalid(): never {
  throw new ApplicationError('INTERNAL_ERROR', 'Stored SKU specification is invalid');
}

export function storeSkuSpecification(value: unknown): StoreSkuSpecification | null {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return invalid();
  const specification = value as Record<string, unknown>;
  if (!Object.hasOwn(specification, 'attributes') || Object.keys(specification).length !== 1 ||
    !Array.isArray(specification.attributes) || specification.attributes.length === 0) {
    return invalid();
  }
  const seen = new Set<string>();
  const attributes = specification.attributes.map((item: unknown) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return invalid();
    const attribute = item as Record<string, unknown>;
    if (Object.keys(attribute).length !== 2 || !Object.hasOwn(attribute, 'name') ||
      !Object.hasOwn(attribute, 'value') || typeof attribute.name !== 'string' ||
      typeof attribute.value !== 'string' || attribute.name.trim().length === 0 ||
      attribute.value.trim().length === 0 || Array.from(attribute.name).length > 80 ||
      Array.from(attribute.value).length > 160) return invalid();
    const identity = JSON.stringify([attribute.name, attribute.value]);
    if (seen.has(identity)) return invalid();
    seen.add(identity);
    return { name: attribute.name, value: attribute.value };
  });
  return { attributes };
}
