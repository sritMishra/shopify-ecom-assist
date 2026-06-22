import { Box, CircularProgress, Link, Paper, Typography } from '@mui/material';
import type { Message } from 'ai';
import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { Product } from '@/types';

import { ProductGrid } from './ProductGrid';

interface Props {
  messages: Message[];
  isLoading: boolean;
}

export function MessageList({ messages, isLoading }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Fires on every messages change, including mid-stream token appends — intentional.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography color="text.secondary">Ask me anything about our products</Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        flex: 1,
        overflowY: 'auto',
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      {messages.map((msg) => {
        // Detect streaming: last assistant message while a request is in flight
        const isStreaming =
          isLoading && msg.role === 'assistant' && msg.id === messages[messages.length - 1]?.id;

        // Extract products from completed tool invocations
        const products: Product[] =
          msg.toolInvocations
            ?.filter((inv) => inv.toolName === 'search_products' && inv.state === 'result')
            .flatMap((inv) => {
              if (inv.state === 'result' && Array.isArray(inv.result)) {
                return inv.result as Product[];
              }
              return [];
            }) ?? [];

        return (
          <Box
            key={msg.id}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            <Paper
              elevation={1}
              sx={{
                p: 1.5,
                maxWidth: '75%',
                bgcolor: msg.role === 'user' ? 'primary.main' : 'background.paper',
                color: msg.role === 'user' ? 'primary.contrastText' : 'text.primary',
                borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
              }}
            >
              {msg.role === 'user' ? (
                <Typography
                  variant="body1"
                  sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                >
                  {msg.content}
                </Typography>
              ) : (
                <Box
                  sx={{
                    wordBreak: 'break-word',
                    fontSize: '1rem',
                    lineHeight: 1.6,
                    '& p': { m: 0, mb: 0.75 },
                    '& p:last-child': { mb: 0 },
                    '& h1,& h2,& h3,& h4': { mt: 1, mb: 0.5, fontWeight: 700 },
                    '& h1': { fontSize: '1.1rem' },
                    '& h2': { fontSize: '1rem' },
                    '& h3,& h4': { fontSize: '0.9rem' },
                    '& ul,& ol': { m: 0, mb: 0.75, pl: 2.5 },
                    '& li': { mb: 0.25 },
                    '& strong': { fontWeight: 700 },
                    '& a': { color: 'inherit', textDecorationColor: 'currentcolor' },
                    '& img': { display: 'none' },
                  }}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ href, children }) => (
                        <Link
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          underline="hover"
                        >
                          {children}
                        </Link>
                      ),
                      img: () => null,
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                  {isStreaming && (
                    <Box
                      component="span"
                      sx={{
                        display: 'inline-block',
                        width: '2px',
                        height: '1em',
                        bgcolor: 'currentcolor',
                        ml: 0.5,
                        verticalAlign: 'text-bottom',
                        animation: 'blink 1s step-end infinite',
                        '@keyframes blink': { '50%': { opacity: 0 } },
                      }}
                    />
                  )}
                </Box>
              )}
            </Paper>
            {products.length > 0 && (
              <Box sx={{ mt: 1, width: '100%', maxWidth: 800 }}>
                <ProductGrid products={products} />
              </Box>
            )}
          </Box>
        );
      })}
      {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
          <CircularProgress size={20} />
        </Box>
      )}
      {/* Sentinel at the bottom — stable ref that doesn't shift as messages are appended. */}
      <div ref={bottomRef} />
    </Box>
  );
}
