import "@testing-library/jest-dom/vitest";
import { MotionGlobalConfig } from "framer-motion";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

MotionGlobalConfig.skipAnimations = true;

afterEach(() => cleanup());
