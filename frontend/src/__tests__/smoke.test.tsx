import { render, screen } from '@testing-library/react';

function Hello() {
  return <h1>Lumberjack Tasks</h1>;
}

describe('test harness', () => {
  it('renders a component under jsdom', () => {
    render(<Hello />);
    expect(screen.getByText('Lumberjack Tasks')).toBeInTheDocument();
  });
});
