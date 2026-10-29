import { notFound } from "next/navigation";
import { Suspense } from "react";
import CategoryView, { CategoryLoading } from "@/components/category-view";
import { categoryBySlug } from "@/lib/catalog";
import { getCatalog } from "@/lib/shopkit";

export async function generateStaticParams() {
  const catalog = await getCatalog(null);
  return catalog.categories.map((category) => ({ slug: category.slug }));
}

async function CategoryContent({
  params,
  searchParams,
}: PageProps<"/[locale]/category/[slug]">) {
  const [{ slug }, { filter }] = await Promise.all([params, searchParams]);
  if (!categoryBySlug(await getCatalog(null), slug)) notFound();
  return (
    <CategoryView
      slug={slug}
      filterSlug={typeof filter === "string" ? filter : undefined}
    />
  );
}

export default function CategoryPage(
  props: PageProps<"/[locale]/category/[slug]">,
) {
  return (
    <Suspense fallback={<CategoryLoading />}>
      <CategoryContent {...props} />
    </Suspense>
  );
}
