import { StyleSheet, Text, View } from "react-native";

import { colors, typography } from "../../theme";
import type { ProfileAngle } from "../../types/wingr";
import { ExpandableInsightCard } from "./ConversationContent";

// Topic chip colours from the Figma "The Angle" card (node 6774:1489), used in
// order and repeated for longer lists.
const TOPIC_CHIP_VARIANTS = [
  {
    backgroundColor: "rgba(30, 58, 138, 0.5)",
    borderColor: "rgba(37, 99, 235, 0.7)",
    color: "#BFDBFE",
  },
  {
    backgroundColor: "rgba(49, 46, 129, 0.5)",
    borderColor: "rgba(79, 70, 229, 0.7)",
    color: "#C7D2FE",
  },
  {
    backgroundColor: "rgba(22, 78, 99, 0.5)",
    borderColor: "rgba(8, 145, 178, 0.7)",
    color: "#A5F3FC",
  },
  {
    backgroundColor: "rgba(124, 45, 18, 0.5)",
    borderColor: "rgba(234, 88, 12, 0.7)",
    color: "#FED7AA",
  },
  {
    backgroundColor: "rgba(113, 63, 18, 0.5)",
    borderColor: "rgba(202, 138, 4, 0.7)",
    color: "#FEF08A",
  },
  {
    backgroundColor: "rgba(19, 78, 74, 0.5)",
    borderColor: "rgba(13, 148, 136, 0.7)",
    color: "#99F6E4",
  },
] as const;

// Start Conversation's read of the profile: what it says about them, the topics
// worth picking up and how to open. Closed it shows one line of the summary.
export function TheAngleCard({
  angle,
  defaultExpanded = true,
}: {
  angle: ProfileAngle;
  defaultExpanded?: boolean;
}) {
  return (
    <ExpandableInsightCard
      accessibilityName="the angle"
      defaultExpanded={defaultExpanded}
      emoji="👀"
      summary={angle.summary}
      title="The Angle"
    >
      <View style={styles.sections}>
        <View style={[styles.section, styles.topicsSection]}>
          <SectionHeading emoji="🗝️" title="Topics you can mention" />
          <View style={styles.topics}>
            {angle.topics.map((topic, index) => {
              const variant =
                TOPIC_CHIP_VARIANTS[index % TOPIC_CHIP_VARIANTS.length];
              return (
                <View
                  key={`${index}-${topic}`}
                  style={[
                    styles.topic,
                    {
                      backgroundColor: variant.backgroundColor,
                      borderColor: variant.borderColor,
                    },
                  ]}
                >
                  <Text style={[styles.topicText, { color: variant.color }]}>
                    {topic}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
        <View style={[styles.section, styles.moveSection]}>
          <SectionHeading emoji="🎲" title="Your Move" />
          <Text style={styles.moveText}>{angle.yourMove}</Text>
        </View>
      </View>
    </ExpandableInsightCard>
  );
}

function SectionHeading({ emoji, title }: { emoji: string; title: string }) {
  return (
    <View style={styles.heading}>
      <Text style={styles.headingEmoji}>{emoji}</Text>
      <Text accessibilityRole="header" style={styles.headingText}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { alignItems: "center", flexDirection: "row", gap: 6 },
  headingEmoji: { fontSize: 18, lineHeight: 22 },
  headingText: {
    ...typography.titleSemibold16,
    color: colors.stone50,
    flex: 1,
    fontSize: 18,
    lineHeight: 22,
  },
  moveSection: {
    backgroundColor: "rgba(69, 26, 3, 0.2)",
    borderColor: colors.amber900,
    gap: 10,
  },
  moveText: {
    ...typography.summaryMedium16,
    color: colors.stone50,
    lineHeight: 20,
  },
  section: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 8,
  },
  sections: { gap: 16, marginTop: 16 },
  topic: {
    borderRadius: 30,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  topicText: { ...typography.summaryMedium16, lineHeight: 20 },
  topics: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  topicsSection: {
    backgroundColor: "rgba(23, 37, 84, 0.2)",
    borderColor: colors.blue900,
    gap: 12,
  },
});
