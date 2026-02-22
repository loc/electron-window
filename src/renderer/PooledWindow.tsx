import React, { type ReactNode } from "react";
import { Window, type WindowRef } from "./Window.js";
import type {
  BaseWindowProps,
  WindowShape,
  WindowPoolConfig,
} from "../shared/types.js";

/**
 * Pool configuration for PooledWindow
 */
export interface WindowPoolDefinition {
  /** The window shape (creation-only props) */
  shape: WindowShape;
  /** Pool configuration */
  config?: WindowPoolConfig;
}

/**
 * Props for PooledWindow component
 */
export interface PooledWindowProps extends Omit<
  BaseWindowProps,
  keyof WindowShape
> {
  /** The pool to acquire windows from */
  pool: WindowPoolDefinition;
  /** Content to render in the window */
  children: ReactNode;
}

/**
 * Create a window pool definition
 */
export function createWindowPoolDefinition(
  shape: WindowShape,
  config?: WindowPoolConfig,
): WindowPoolDefinition {
  return { shape, config: config ?? {} };
}

/**
 * Window component that uses a specific pool.
 * The pool's shape defines the immutable window properties.
 */
export const PooledWindow = React.forwardRef<WindowRef, PooledWindowProps>(
  function PooledWindow({ pool, children, ...props }, ref) {
    const mergedProps = {
      ...props,
      ...pool.shape,
    };

    return (
      <Window ref={ref} {...mergedProps}>
        {children}
      </Window>
    );
  },
);

PooledWindow.displayName = "PooledWindow";
