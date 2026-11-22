// The test set-up works: a component renders, and the code shared with the server is reachable.
import { render, screen } from '@testing-library/react-native';
import { valueKey } from '../src/tags';
import { Placeholder } from '../src/ui/Placeholder';

describe('app foundations', () => {
  it('renders a screen', async () => {
    await render(<Placeholder title="My work" />);
    expect(screen.getByText('My work')).toBeTruthy();
  });

  it('shares tag value rules with the server', () => {
    expect(valueKey(' ta-118 342 ')).toBe('TA118342');
  });
});
