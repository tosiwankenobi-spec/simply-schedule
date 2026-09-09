import React from 'react'
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

export interface ReminderActionProps {
  /** "done" or "snooze" */
  action?: 'done' | 'snooze'
  reminderTitle?: string
  reminderBody?: string
  /** Formatted local time the reminder returns, for snoozes. */
  snoozedUntilLabel?: string
}

const headline = ({ action }: ReminderActionProps) =>
  action === 'snooze' ? 'Reminder snoozed' : 'Marked as done'

const Email = ({
  action = 'done',
  reminderTitle,
  reminderBody,
  snoozedUntilLabel,
}: ReminderActionProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      {action === 'snooze'
        ? `Snoozed: ${reminderTitle ?? 'your reminder'}`
        : `Completed: ${reminderTitle ?? 'your reminder'}`}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>Chronos-V</Text>
        <Heading style={heading}>{headline({ action })}</Heading>
        <Section style={card}>
          <Text style={title}>{reminderTitle ?? 'Your reminder'}</Text>
          {reminderBody ? <Text style={body}>{reminderBody}</Text> : null}
        </Section>
        <Text style={body}>
          {action === 'snooze'
            ? snoozedUntilLabel
              ? `Chronos-V will bring this back at ${snoozedUntilLabel}.`
              : 'Chronos-V will bring this back shortly.'
            : 'Your plan has been updated to reflect this.'}
        </Text>
        <Hr style={rule} />
        <Text style={footer}>Your schedule, synthesized.</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (data: Record<string, any>) =>
    data['action'] === 'snooze'
      ? `Snoozed: ${data['reminderTitle'] ?? 'your reminder'}`
      : `Done: ${data['reminderTitle'] ?? 'your reminder'}`,
  displayName: 'Reminder action confirmation',
  previewData: {
    action: 'snooze',
    reminderTitle: 'Dentist appointment',
    reminderBody: 'Starts at 2:30 PM at 14 Rose Street.',
    snoozedUntilLabel: '2:15 PM',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Georgia, "Times New Roman", serif' }
const container = { padding: '28px 26px', maxWidth: '560px' }
const brand = {
  margin: '0 0 6px',
  fontSize: '12px',
  letterSpacing: '0.14em',
  textTransform: 'uppercase' as const,
  color: '#0F7A69',
}
const heading = { margin: '0 0 16px', fontSize: '24px', color: '#002E28' }
const card = {
  backgroundColor: '#F8F7F4',
  borderRadius: '14px',
  padding: '16px 18px',
  margin: '0 0 16px',
}
const title = { margin: '0 0 6px', fontSize: '16px', color: '#002E28', fontWeight: 600 }
const body = { margin: '0 0 8px', fontSize: '14px', lineHeight: '22px', color: '#3F4B48' }
const rule = { borderColor: '#E4E2DC', margin: '22px 0 12px' }
const footer = { margin: 0, fontSize: '12px', color: '#8A918E' }
