/**
 * The product-field input of a cart line as an identity string, for code that
 * keys lines by WHAT they hold (product, variant, input) rather than by line id.
 * The platform treats the same variant with different input as separate lines,
 * so such keys must include it.
 *
 * Order-independent (sorted by `propertyId`, then value) and collision-free
 * (JSON, so shopper-typed separators cannot forge a boundary). The empty
 * string for a line without input.
 */
export function linePropertiesKey(
	properties:
		| ReadonlyArray<{ propertyId: number | string; value: string }>
		| null
		| undefined,
): string {
	if (!properties || properties.length === 0) return "";
	const pairs = properties
		.map((property): [string, string] => [
			String(property.propertyId),
			property.value,
		])
		.sort(([idA, valueA], [idB, valueB]) =>
			idA === idB
				? valueA < valueB
					? -1
					: valueA > valueB
						? 1
						: 0
				: Number(idA) - Number(idB),
		);
	return JSON.stringify(pairs);
}
