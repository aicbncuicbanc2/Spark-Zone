import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { ErrorState } from '../../components/ErrorState';
import { alert } from '../../lib/alert';
import { useMe, useUpdatePreferences } from '../../lib/queries';
import { colors } from '../../lib/theme';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
// Matches the push payload's advance_3d/advance_1d "kind" values documented
// in api.md — offering exactly these keeps whatever the user picks
// guaranteed to line up with a real reminder kind the backend can send.
const LEAD_DAY_OPTIONS = [14, 7, 3, 1];

export default function SettingsScreen() {
  const router = useRouter();
  const { data, isLoading, error, refetch } = useMe();
  const updateMutation = useUpdatePreferences();

  const [timezone, setTimezone] = useState('');
  const [leadDays, setLeadDays] = useState<number[]>([]);
  const [quietStart, setQuietStart] = useState('');
  const [quietEnd, setQuietEnd] = useState('');
  const [pushEnabled, setPushEnabled] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setTimezone(data.timezone);
    setLeadDays(data.reminder_lead_days);
    setQuietStart(data.quiet_hours_start.slice(0, 5));
    setQuietEnd(data.quiet_hours_end.slice(0, 5));
    setPushEnabled(data.push_enabled);
  }, [data]);

  function toggleLeadDay(day: number) {
    setLeadDays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort((a, b) => b - a)
    );
  }

  function handleSave() {
    setFormError(null);
    if (!timezone.trim()) return setFormError('Timezone is required.');
    if (!TIME_RE.test(quietStart)) return setFormError('Quiet hours start must be HH:MM (24h).');
    if (!TIME_RE.test(quietEnd)) return setFormError('Quiet hours end must be HH:MM (24h).');

    updateMutation.mutate(
      {
        timezone: timezone.trim(),
        reminder_lead_days: leadDays,
        quiet_hours_start: `${quietStart}:00`,
        quiet_hours_end: `${quietEnd}:00`,
        push_enabled: pushEnabled,
      },
      {
        onSuccess: () => {
          alert('Saved', 'Your notification preferences were updated.');
          router.back();
        },
        onError: (err) => setFormError((err as Error).message),
      }
    );
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.navy} />
      </View>
    );
  }

  if (error || !data) {
    return <ErrorState title="Couldn't load your preferences." message={(error as Error)?.message} onRetry={refetch} />;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Timezone</Text>
      <TextInput
        style={styles.input}
        value={timezone}
        onChangeText={setTimezone}
        placeholder="Asia/Kuala_Lumpur"
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>Remind me before expiry</Text>
      <View style={styles.chipRow}>
        {LEAD_DAY_OPTIONS.map((day) => {
          const selected = leadDays.includes(day);
          return (
            <Pressable
              key={day}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => toggleLeadDay(day)}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {day} day{day === 1 ? '' : 's'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.inlineRow}>
        <View style={styles.inlineField}>
          <Text style={styles.label}>Quiet hours start</Text>
          <TextInput
            style={styles.input}
            value={quietStart}
            onChangeText={setQuietStart}
            placeholder="22:00"
            keyboardType="numbers-and-punctuation"
          />
        </View>
        <View style={styles.inlineField}>
          <Text style={styles.label}>Quiet hours end</Text>
          <TextInput
            style={styles.input}
            value={quietEnd}
            onChangeText={setQuietEnd}
            placeholder="08:00"
            keyboardType="numbers-and-punctuation"
          />
        </View>
      </View>

      <View style={styles.switchRow}>
        <View style={styles.switchLabelWrap}>
          <Text style={styles.switchLabel}>Push notifications</Text>
          <Text style={styles.switchSubtext}>Get reminders as items approach expiry.</Text>
        </View>
        <Switch
          value={pushEnabled}
          onValueChange={setPushEnabled}
          trackColor={{ true: colors.navy }}
        />
      </View>

      {formError && <Text style={styles.error}>{formError}</Text>}

      <Pressable
        style={[styles.submit, updateMutation.isPending && styles.submitDisabled]}
        disabled={updateMutation.isPending}
        onPress={handleSave}
      >
        {updateMutation.isPending ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.submitText}>Save</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cream,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  label: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 14,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: colors.white,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.white,
  },
  chipSelected: {
    borderColor: colors.navy,
    backgroundColor: colors.navy,
  },
  chipText: {
    fontSize: 14,
    color: colors.navy,
  },
  chipTextSelected: {
    color: colors.white,
    fontWeight: '600',
  },
  inlineRow: {
    flexDirection: 'row',
    gap: 12,
  },
  inlineField: {
    flex: 1,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 22,
    gap: 12,
  },
  switchLabelWrap: {
    flex: 1,
    gap: 2,
  },
  switchLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.navy,
  },
  switchSubtext: {
    fontSize: 12,
    color: colors.textMuted,
  },
  error: {
    color: colors.danger,
    marginTop: 14,
    textAlign: 'center',
  },
  submit: {
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  submitDisabled: {
    opacity: 0.5,
  },
  submitText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
});
