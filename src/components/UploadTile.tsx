import { Pressable, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { theme } from "@/theme";

export default function UploadTile({
  title,
  icon,
  onPress,
}: {
  title: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: theme.colors.card,
        borderRadius: theme.radius,
        borderWidth: 2,
        borderColor: theme.colors.gold,
        padding: 16,
        marginBottom: 14,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <MaterialCommunityIcons name={icon} size={28} color={theme.colors.gold} />
        <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "700", marginLeft: 12, flex: 1 }}>
          {title}
        </Text>
        <Pressable
          onPress={() => {}}
          style={{
            borderWidth: 1,
            borderColor: theme.colors.gold,
            borderRadius: 999,
            padding: 6,
          }}
        >
          <MaterialCommunityIcons name="download" size={18} color={theme.colors.gold} />
        </Pressable>
      </View>
    </Pressable>
  );
}
