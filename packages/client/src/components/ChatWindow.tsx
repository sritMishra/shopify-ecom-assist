import { Box, Paper, Typography } from '@mui/material';

import { useChat } from '@/hooks/useChat';

import { MessageInput } from './MessageInput';
import { MessageList } from './MessageList';

export function ChatWindow() {
  const { messages, isLoading, sendMessage } = useChat();

  return (
    <Paper
      elevation={3}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '90vh',
        maxWidth: 900,
        mx: 'auto',
        my: 4,
        overflow: 'hidden',
      }}
    >
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="h6" fontWeight={700}>
          Shopify Shopping Assistant
        </Typography>
      </Box>
      <MessageList messages={messages} isLoading={isLoading} />
      <MessageInput onSend={sendMessage} disabled={isLoading} />
    </Paper>
  );
}
