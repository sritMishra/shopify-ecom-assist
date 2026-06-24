import { Card, CardContent, CardMedia, Chip, Link, Stack, Typography } from '@mui/material';

import type { Product } from '@/types';

interface Props {
  product: Product;
}

function formatPrice(amount: number, currencyCode: string): string {
  // Guard against empty/invalid currency code from vector search results
  if (!currencyCode) return amount.toFixed(2);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode }).format(
    amount
  );
}

export function ProductCard({ product }: Props) {
  const { title, image, price, tags, url } = product;
  const samePrice = price.min.amount === price.max.amount;
  const priceLabel = samePrice
    ? formatPrice(price.min.amount, price.min.currencyCode)
    : `${formatPrice(price.min.amount, price.min.currencyCode)} – ${formatPrice(price.max.amount, price.max.currencyCode)}`;

  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {image && (
        <CardMedia
          component="img"
          height={180}
          image={image.url}
          alt={image.altText ?? title}
          sx={{ objectFit: 'cover' }}
        />
      )}
      <CardContent sx={{ flexGrow: 1 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom noWrap>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          {priceLabel}
        </Typography>
        {tags.length > 0 && (
          <Stack direction="row" flexWrap="wrap" gap={0.5} mt={1}>
            {tags.slice(0, 4).map((tag) => (
              <Chip key={tag} label={tag} size="small" variant="outlined" />
            ))}
          </Stack>
        )}
      </CardContent>
      <Link
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        underline="none"
        sx={{ p: 1.5, pt: 0, display: 'block', fontWeight: 600, fontSize: '0.875rem' }}
      >
        View Product →
      </Link>
    </Card>
  );
}
