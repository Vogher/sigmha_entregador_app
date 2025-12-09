import { forwardRef } from "react";
import { TextInput, View, Text, TextInputProps } from "react-native";
import { theme } from "@/theme";


interface Props extends TextInputProps {
label?: string;
error?: string;
right?: React.ReactNode;
}


const FormTextInput = forwardRef<TextInput, Props>(({ label, error, right, ...rest }, ref) => {
return (
<View style={{ marginBottom: 14 }}>
{label ? <Text style={{ color: theme.colors.text, marginBottom: 6 }}>{label}</Text> : null}
<View style={{
backgroundColor: theme.colors.card,
borderRadius: theme.radius,
borderWidth: 1,
borderColor: error ? theme.colors.danger : theme.colors.borderDark,
flexDirection: "row",
alignItems: "center",
paddingHorizontal: 12
}}>
<TextInput
ref={ref}
placeholderTextColor={theme.colors.muted}
style={{ flex: 1, color: theme.colors.text, paddingVertical: 12, fontSize: 16 }}
{...rest}
/>
{right}
</View>
{error ? <Text style={{ color: theme.colors.danger, marginTop: 6 }}>{error}</Text> : null}
</View>
);
});


export default FormTextInput;