import { Pressable, Text } from "react-native";
import { theme } from "@/theme";

export default function PrimaryButton({
  title,
  onPress,
  disabled,
  loading,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => ({
        backgroundColor: pressed ? theme.colors.black : theme.colors.gold,
        borderColor: pressed ? theme.colors.gold : theme.colors.black,
        borderWidth: 2,
        opacity: disabled ? 0.6 : 1,
        paddingVertical: 14,
        borderRadius: theme.radius,
        alignItems: "center",
      })}
    >
      {({ pressed }) => (
        <Text
          style={{
            color: pressed ? theme.colors.gold : theme.colors.black,
            fontWeight: "800",
            fontSize: 16,
          }}
        >
          {loading ? "..." : title}
        </Text>
      )}
    </Pressable>
  );
}
