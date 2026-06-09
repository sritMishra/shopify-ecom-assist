import { Typography } from '@mui/material';
import Grid from '@mui/material/Grid2';

import type { Product } from '@/types';

import { ProductCard } from './ProductCard';

interface Props {
  products: Product[];
}

export function ProductGrid({ products }: Props) {
  if (products.length === 0) return null;

  return (
    <div>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
        Found {products.length} product{products.length !== 1 ? 's' : ''}
      </Typography>
      <Grid container spacing={2}>
        {products.map((product) => (
          <Grid key={product.id} size={{ xs: 12, sm: 6, md: 4 }}>
            <ProductCard product={product} />
          </Grid>
        ))}
      </Grid>
    </div>
  );
}
