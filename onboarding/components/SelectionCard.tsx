import { Pressable, StyleSheet, Text, View } from 'react-native';

type SelectionCardProps = {
  description?: string;
  onPress?: () => void;
  selected?: boolean;
  title: string;
};

export function SelectionCard({ description, onPress, selected = false, title }: SelectionCardProps) {
  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.pressable}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.surface,
            selected && styles.selectedSurface,
            pressed && styles.pressedSurface,
          ]}
        >
          <Text style={styles.title}>{title}</Text>
          {description ? <Text style={styles.description}>{description}</Text> : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  description: {
    color: '#D8D8D8',
    fontFamily: 'ClashGroteskRegular',
    fontSize: 13,
    lineHeight: 17,
    marginTop: 4,
    textAlign: 'center',
  },
  pressable: {
    width: '100%',
  },
  pressedSurface: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  selectedSurface: {
    backgroundColor: '#575757',
  },
  surface: {
    alignItems: 'center',
    backgroundColor: '#242424',
    borderRadius: 10,
    height: 60,
    justifyContent: 'center',
    paddingHorizontal: 14,
    width: '100%',
  },
  title: {
    color: '#FFFFFF',
    fontFamily: 'ClashGrotesk',
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 20,
    textAlign: 'center',
  },
});
