// Account > Open-source licenses (E38-09): the packages the app is built with (src/about/licenses.json,
// generated from the lockfile by `npm run licenses`). Owner: APP-CORE.
import { FlatList, StyleSheet, Text, View } from 'react-native';
import licenses from '../../../src/about/licenses.json';
import { accountText } from '../../../src/text/account';
import { fontSize, space, useTheme } from '../../../src/theme';

export default function LicensesScreen() {
  const { colors } = useTheme();
  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space[4] }}
      data={licenses as { name: string; version: string; license: string }[]}
      keyExtractor={(p) => `${p.name}@${p.version}`}
      ListHeaderComponent={<Text style={[styles.intro, { color: colors.textMuted }]}>{accountText.licensesScreen.intro}</Text>}
      renderItem={({ item }) => (
        <View accessible style={[styles.row, { borderBottomColor: colors.border }]}>
          <Text style={[styles.name, { color: colors.text }]}>{item.name} {item.version}</Text>
          <Text style={[styles.license, { color: colors.textMuted }]}>{item.license}</Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: fontSize.lg, marginBottom: space[3] },
  row: { paddingVertical: space[2], borderBottomWidth: StyleSheet.hairlineWidth },
  name: { fontSize: fontSize.md, fontWeight: '600' },
  license: { fontSize: fontSize.sm },
});
