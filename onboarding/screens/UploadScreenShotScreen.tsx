import { AddSquare } from '@solar-icons/react-native/Linear';
import { StyleSheet, Text, View } from 'react-native';
import { OnboardingScreenScaffold } from './OnboardingScreenScaffold';
import type { OnboardingScreenProps } from '../types/onboarding';

export function UploadScreenShotScreen(props: OnboardingScreenProps) {
  return (
    <OnboardingScreenScaffold {...props}>
      <View style={styles.uploadBox}>
        <Text style={styles.uploadText}>Press to upload screenshot</Text>
        <AddSquare color="#E8E8E8" size={22} />
      </View>
    </OnboardingScreenScaffold>
  );
}

const styles = StyleSheet.create({
  uploadBox: {
    alignItems: 'center',
    alignSelf: 'center',
    aspectRatio: 0.586,
    backgroundColor: '#171717',
    borderColor: '#5D5D5D',
    borderRadius: 20,
    borderStyle: 'dashed',
    borderWidth: 1,
    gap: 18,
    justifyContent: 'center',
    width: '74%',
  },
  uploadText: {
    color: '#D8D8D8',
    fontFamily: 'ClashGrotesk',
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 22,
    textAlign: 'center',
  },
});
