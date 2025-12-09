// src/components/BrandLogo.tsx
import { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import { theme } from "@/theme";

export default function BrandLogo() {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1200, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.02] });

  return (
    <View style={{ alignItems: "center", marginBottom: 24 }}>
      {/* anel dourado pulsando atrás da logo */}
      <Animated.View
        style={{
          position: "absolute",
          width: 180,
          height: 180,
          borderRadius: 999,
          backgroundColor: "#d4af3722", // dourado com transparência
          borderWidth: 2,
          borderColor: theme.colors.gold,
          transform: [{ scale: ringScale }],
          opacity: ringOpacity,
        }}
      />
      <Animated.Image
        source={require("../../png/logo.png")}
        style={{ width: 140, height: 140, resizeMode: "contain", transform: [{ scale }] }}
      />
    </View>
  );
}
