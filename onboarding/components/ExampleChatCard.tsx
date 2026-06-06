import { StyleSheet, Text, View } from 'react-native';
import type { OnboardingChatMessage } from '../types/onboarding';

type ExampleChatCardProps = {
  messages: OnboardingChatMessage[];
};

export function ExampleChatCard({ messages }: ExampleChatCardProps) {
  return (
    <View style={styles.card}>
      {messages.map((message) => {
        const user = message.side === 'user';

        return (
          <View key={message.id} style={[styles.bubble, user ? styles.userBubble : styles.otherBubble]}>
            <Text style={[styles.messageText, user ? styles.userText : styles.otherText]}>{message.text}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    borderRadius: 16,
    maxWidth: '84%',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  card: {
    backgroundColor: '#101010',
    borderColor: '#2B2B2F',
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    padding: 14,
    width: '100%',
  },
  messageText: {
    fontFamily: 'ClashGroteskRegular',
    fontSize: 15,
    lineHeight: 20,
  },
  otherBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#252529',
  },
  otherText: {
    color: '#F6F7FB',
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#1970FD',
  },
  userText: {
    color: '#FFFFFF',
  },
});
