import { Pressable, Text } from "react-native";
import { theme } from "@/theme";

export default function OutlineButton({
  title,
  onPress,
}: {
  title: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? theme.colors.gold : theme.colors.black,
        borderColor: pressed ? theme.colors.black : theme.colors.gold,
        borderWidth: 2,
        paddingVertical: 12,
        borderRadius: theme.radius,
        alignItems: "center",
      })}
    >
      {({ pressed }) => (
        <Text
          style={{
            color: pressed ? theme.colors.black : theme.colors.gold,
            fontWeight: "700",
            fontSize: 15,
          }}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}
