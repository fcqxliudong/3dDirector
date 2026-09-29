import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// 部署位置：ai_video/static/director_stage/
// base 用相对路径（不是 /assets 而是 ./assets）· 方便部署到任何子路径
export default defineConfig({
    base: './',
    plugins: [react()],
    build: {
        target: 'es2022',
        outDir: 'dist',
        assetsInlineLimit: 4096,
        chunkSizeWarningLimit: 1500,
        rollupOptions: {
            output: {
                // 函数形式 · 按 id 强制 vendor 拆分 · 避免 React / GSAP 被 inline 进 entry
                manualChunks(id) {
                    if (id.includes('node_modules/three/'))
                        return 'three';
                    if (id.includes('node_modules/@react-three/'))
                        return 'r3f';
                    if (id.includes('node_modules/react/') ||
                        id.includes('node_modules/react-dom/') ||
                        id.includes('node_modules/scheduler/')) {
                        return 'react';
                    }
                    if (id.includes('node_modules/gsap/'))
                        return 'gsap';
                    if (id.includes('node_modules/zustand/'))
                        return 'zustand';
                    return undefined; // 其他进 entry
                },
            },
            onwarn(warning, warn) {
                // 透传给 Vite 默认 logger · build 时会自动打印到终端
                warn(warning);
            },
        },
    },
    server: {
        port: 5173,
        host: '127.0.0.1',
    },
    logLevel: 'info',
    clearScreen: false,
});
