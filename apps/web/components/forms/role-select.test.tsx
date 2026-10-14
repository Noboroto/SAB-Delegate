import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import { RoleSelect } from './role-select';

const GUILD = '1'.repeat(18);
const MOD = '2'.repeat(18);
const BOT = '3'.repeat(18);
const roles = [
  { id: MOD, name: 'Moderator', color: 0, position: 2, managed: false },
  { id: BOT, name: 'Helper bot', color: 0, position: 1, managed: true },
];

function stubRoles() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(roles)))),
  );
}

describe('RoleSelect', () => {
  it('lists the roles and reports the pick', async () => {
    stubRoles();
    const onChange = vi.fn();
    renderWithProviders(<RoleSelect guildId={GUILD} onChange={onChange} />);
    await userEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByText('Helper bot')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Moderator'));
    expect(onChange).toHaveBeenCalledWith(MOD);
  });

  it('can leave out roles an integration owns', async () => {
    stubRoles();
    renderWithProviders(<RoleSelect guildId={GUILD} hideManaged />);
    await userEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByText('Moderator')).toBeInTheDocument();
    expect(screen.queryByText('Helper bot')).not.toBeInTheDocument();
  });

  it('reports a list of ids in multiple mode', async () => {
    stubRoles();
    const onChange = vi.fn();
    renderWithProviders(<RoleSelect guildId={GUILD} multiple value={[BOT]} onChange={onChange} />);
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByText('Moderator'));
    expect(onChange).toHaveBeenCalledWith([BOT, MOD]);
  });
});
