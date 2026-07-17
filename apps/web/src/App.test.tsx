import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the shell with navigation and the health landing page', () => {
  render(<App />);
  expect(screen.getByRole('link', { name: 'Health' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Explore' })).toBeInTheDocument();
  expect(screen.getByText('Program health')).toBeInTheDocument();
});
