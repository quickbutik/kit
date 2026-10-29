import { Catalogue } from "@/components/catalogue"
import { getCatalog } from "@/lib/catalog"

export default async function CataloguePage() {
  const products = await getCatalog()
  return <Catalogue products={products} />
}
