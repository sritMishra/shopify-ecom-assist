import { zodResolver } from '@hookform/resolvers/zod';
import SendIcon from '@mui/icons-material/Send';
import { Box, IconButton, TextField } from '@mui/material';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const schema = z.object({
  message: z.string().min(1, 'Message cannot be empty').max(2000),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  onSend: (content: string) => void;
  disabled: boolean;
}

export function MessageInput({ onSend, disabled }: Props) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = (data: FormValues) => {
    onSend(data.message.trim());
    reset();
  };

  const submit = () => void handleSubmit(onSubmit)();

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <Box
      component="form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      sx={{ display: 'flex', gap: 1, p: 2, borderTop: 1, borderColor: 'divider' }}
    >
      <TextField
        {...register('message')}
        fullWidth
        multiline
        maxRows={4}
        placeholder="Ask about products…"
        disabled={disabled}
        onKeyDown={handleKeyDown}
        error={!!errors.message}
        helperText={errors.message?.message}
        size="small"
      />
      <IconButton type="submit" color="primary" disabled={disabled} sx={{ alignSelf: 'flex-end' }}>
        <SendIcon />
      </IconButton>
    </Box>
  );
}
