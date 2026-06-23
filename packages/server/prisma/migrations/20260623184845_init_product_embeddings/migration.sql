-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "product_embeddings" (
    "id" SERIAL NOT NULL,
    "shopify_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "product_type" TEXT,
    "tags" TEXT[],
    "price_min" DOUBLE PRECISION,
    "price_max" DOUBLE PRECISION,
    "handle" TEXT,
    "image_url" TEXT,
    "embedding" vector(1536) NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_embeddings_shopify_id_key" ON "product_embeddings"("shopify_id");
