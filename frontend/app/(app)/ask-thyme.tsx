import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAskThyme } from '../../lib/queries';
import { colors, fontSize } from '../../lib/theme';
import type { AskThymeRequest, ChatMessage } from '../../lib/types';

const WELCOME: ChatMessage = {
  role: 'assistant',
  text: "Hi, I'm Thyme. Ask me things like \"what's expiring this week?\" or \"can I still use this?\" — I'll answer from what's actually in your pantry.",
};

export default function AskThymeScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [lastRequest, setLastRequest] = useState<AskThymeRequest | null>(null);
  const askMutation = useAskThyme();
  const listRef = useRef<FlatList>(null);

  function send(question: string, history: ChatMessage[]) {
    const request: AskThymeRequest = { question, history };
    setLastRequest(request);
    askMutation.mutate(request, {
      onSuccess: (data) => {
        setMessages((prev) => [...prev, { role: 'assistant', text: data.answer }]);
        requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
      },
    });
  }

  function handleSend() {
    const question = input.trim();
    if (!question || askMutation.isPending) return;
    const history = messages;
    setMessages((prev) => [...prev, { role: 'user', text: question }]);
    setInput('');
    send(question, history);
  }

  function handleRetry() {
    if (!lastRequest) return;
    send(lastRequest.question, lastRequest.history);
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}
    >
      <FlatList
        ref={listRef}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={messages}
        keyExtractor={(_, index) => String(index)}
        ListHeaderComponent={<Bubble message={WELCOME} />}
        renderItem={({ item }) => <Bubble message={item} />}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
      />

      {askMutation.isPending && (
        <View style={styles.typingRow}>
          <ActivityIndicator size="small" color={colors.navy} />
          <Text style={styles.typingText}>Thyme is thinking…</Text>
        </View>
      )}

      {askMutation.isError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{(askMutation.error as Error).message}</Text>
          <Pressable onPress={handleRetry}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Ask about your pantry…"
          placeholderTextColor={colors.textMuted}
          onSubmitEditing={handleSend}
          returnKeyType="send"
          editable={!askMutation.isPending}
        />
        <Pressable
          style={[styles.sendButton, (!input.trim() || askMutation.isPending) && styles.sendButtonDisabled]}
          disabled={!input.trim() || askMutation.isPending}
          onPress={handleSend}
        >
          <Text style={styles.sendButtonText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <View style={[styles.bubbleRow, isUser && styles.bubbleRowUser]}>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        <Text style={[styles.bubbleText, isUser && styles.bubbleTextUser]}>{message.text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 16,
    gap: 10,
  },
  bubbleRow: {
    flexDirection: 'row',
  },
  bubbleRowUser: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleAssistant: {
    backgroundColor: colors.creamCard,
    borderBottomLeftRadius: 4,
  },
  bubbleUser: {
    backgroundColor: colors.navy,
    borderBottomRightRadius: 4,
  },
  bubbleText: {
    fontSize: fontSize.body,
    lineHeight: 21,
    color: colors.navy,
  },
  bubbleTextUser: {
    color: colors.white,
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  typingText: {
    fontSize: fontSize.caption,
    color: colors.textMuted,
  },
  errorBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#fdecea',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: fontSize.caption,
    color: colors.danger,
  },
  retryText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.danger,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.cream,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: colors.white,
    color: colors.navy,
  },
  sendButton: {
    backgroundColor: colors.navy,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendButtonText: {
    color: colors.white,
    fontWeight: '600',
  },
});
