import { Box, CircularProgress, Paper, Typography } from '@mui/material';
import { useEffect, useRef } from 'react';

import type { UIMessage } from '@/types';

import { ProductGrid } from './ProductGrid';

interface Props {
  messages: UIMessage[];
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
      {messages.map((msg) => (
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
            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {msg.content}
              {msg.isStreaming && (
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
            </Typography>
          </Paper>
          {msg.products && msg.products.length > 0 && (
            <Box sx={{ mt: 1, width: '100%', maxWidth: 800 }}>
              <ProductGrid products={msg.products} />
            </Box>
          )}
        </Box>
      ))}
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
