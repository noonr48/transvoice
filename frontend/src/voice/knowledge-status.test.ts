import { describe, expect, it } from 'vitest';
import { getVoiceKnowledgeStatusLabel } from './knowledge-status';

describe('getVoiceKnowledgeStatusLabel', () => {
  it('prefers the backend status surface label when present', () => {
    expect(getVoiceKnowledgeStatusLabel({
      statusSurface: { label: 'Refresh failed' },
    })).toBe('Refresh failed');
  });

  it('shows compiling when the backend reports the normalized compiler label', () => {
    expect(getVoiceKnowledgeStatusLabel({
      statusSurface: { label: 'Compiling…', state: 'running' },
    })).toBe('Compiling…');
  });

  it('shows compile failed from the normalized backend surface', () => {
    expect(getVoiceKnowledgeStatusLabel({
      statusSurface: { label: 'Compile failed', state: 'failed' },
    })).toBe('Compile failed');
  });

  it('shows refresh failed from the normalized backend surface', () => {
    expect(getVoiceKnowledgeStatusLabel({
      statusSurface: { label: 'Refresh failed', state: 'failed' },
    })).toBe('Refresh failed');
  });

  it('shows ready from the normalized backend surface', () => {
    expect(getVoiceKnowledgeStatusLabel({
      statusSurface: { label: 'Ready', state: 'ready' },
    })).toBe('Ready');
  });

  it('shows provisioned from the normalized backend surface', () => {
    expect(getVoiceKnowledgeStatusLabel({
      statusSurface: { label: 'Provisioned', state: 'provisioned' },
    })).toBe('Provisioned');
  });

  it('shows pending compile from the normalized backend surface', () => {
    expect(getVoiceKnowledgeStatusLabel({
      statusSurface: { label: 'Pending compile', state: 'pending' },
    })).toBe('Pending compile');
  });

  it('falls back to unavailable when no compiler state exists', () => {
    expect(getVoiceKnowledgeStatusLabel(null)).toBe('Unavailable');
  });

  it('falls back to unavailable when the status surface is present but empty', () => {
    expect(getVoiceKnowledgeStatusLabel({
      statusSurface: { label: '   ' },
      activeJobId: 'job-1',
      latestJob: { status: 'failed' },
    })).toBe('Unavailable');
  });
});
