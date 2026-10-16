/**
 * Types for the DSH Web shell's shared UI primitives. The shell provides
 * this module to every client plugin at runtime (it is never bundled);
 * only the components and props this page uses are declared here.
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type {
    ButtonHTMLAttributes, ForwardRefExoticComponent, InputHTMLAttributes, ReactElement, ReactNode, RefAttributes,
  } from 'react';

  export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'ghost' | 'outline' | 'toolbar';
    size?: 'md' | 'sm';
    icon?: ReactNode;
  }
  export const Button: ForwardRefExoticComponent<ButtonProps & RefAttributes<HTMLButtonElement>>;

  export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    icon?: ReactNode;
  }
  export const Input: ForwardRefExoticComponent<InputProps & RefAttributes<HTMLInputElement>>;

  export function Switch(props: {
    checked: boolean;
    onChange(next: boolean): void;
    label: string;
    disabled?: boolean;
    title?: string;
    className?: string;
  }): ReactElement;

  export type TagTone = 'outline' | 'solid' | 'neutral' | 'quiet' | 'success' | 'info' | 'warning' | 'danger';
  export function Tag(props: { tone?: TagTone; className?: string; children?: ReactNode }): ReactElement;

  export function StateDot(props: {
    state: 'done' | 'warning' | 'ongoing' | 'error' | 'idle';
    size?: number;
    className?: string;
  }): ReactElement;

  export interface IconProps { size?: number; className?: string }
  export function IconSearchOutlineRegular(props: IconProps): ReactElement;
  export function IconRefreshOutlineRegular(props: IconProps): ReactElement;
  export function IconChevronRightOutlineRegular(props: IconProps): ReactElement;
  export function IconFolderCloseRegular(props: IconProps): ReactElement;
  export function IconPinFillRegular(props: IconProps): ReactElement;
  export function IconUserOutlineRegular(props: IconProps): ReactElement;
  export function IconUsersOutlineRegular(props: IconProps): ReactElement;
  export function IconShieldOutlineRegular(props: IconProps): ReactElement;
  export function IconWarningTriangleOutlineRegular(props: IconProps): ReactElement;
  export function IconCheckCircleOutlineRegular(props: IconProps): ReactElement;
  export function IconCopyOutlineRegular(props: IconProps): ReactElement;
  export function IconPlusOutlineRegular(props: IconProps): ReactElement;
  export function IconCloseOutlineRegular(props: IconProps): ReactElement;
  export function IconSettingsOutlineRegular(props: IconProps): ReactElement;
  export function IconDataOutlineRegular(props: IconProps): ReactElement;

  export function writeClipboard(text: string): Promise<boolean>;
}
