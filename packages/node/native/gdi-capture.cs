// AmbientLight screen-capture helper for Windows (GDI).
//
// apps/pc-cli/src/gdi-capture.ts compiles this file once with the .NET Framework C# compiler (csc.exe) and keeps
// the process running for the whole sync, so a frame costs one screen copy instead of a process start.
//
// Usage: gdi-capture.exe <width> <height> [<display id>]
//   The display id is the one `npm run displays` lists (e.g. \\.\DISPLAY2); without it the primary display is used.
// Protocol: every byte read from stdin requests one frame. The answer is exactly width * height * 4 bytes on
// stdout: the display shrunk to width x height, top-down rows of B, G, R, X (the 4th byte is unused). End of stdin
// ends the process. Errors go to stderr with a non-zero exit code.
//
// Written for C# 5 (the compiler that ships with Windows), so no string interpolation or newer syntax.

using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;

static class GdiCapture
{
    [StructLayout(LayoutKind.Sequential)]
    struct Rect
    {
        public int Left, Top, Right, Bottom;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct MonitorInfoEx
    {
        public int Size;
        public Rect Monitor;
        public Rect Work;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string Device;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct BitmapInfoHeader
    {
        public int Size;
        public int Width;
        public int Height;
        public short Planes;
        public short BitCount;
        public int Compression;
        public int SizeImage;
        public int XPelsPerMeter;
        public int YPelsPerMeter;
        public int ClrUsed;
        public int ClrImportant;
    }

    struct Display
    {
        public string Device;
        public Rect Bounds;
        public bool Primary;
    }

    delegate bool MonitorEnumProc(IntPtr monitor, IntPtr hdc, IntPtr rect, IntPtr data);

    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc proc, IntPtr data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfoEx info);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr window);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr hdc);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr hdc);
    [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr hdc, ref BitmapInfoHeader info, uint usage, out IntPtr bits, IntPtr section, uint offset);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr dest, int x, int y, int width, int height, IntPtr src, int srcX, int srcY, uint rop);
    [DllImport("gdi32.dll")] static extern bool StretchBlt(IntPtr dest, int x, int y, int width, int height, IntPtr src, int srcX, int srcY, int srcWidth, int srcHeight, uint rop);
    [DllImport("gdi32.dll")] static extern int SetStretchBltMode(IntPtr hdc, int mode);
    [DllImport("gdi32.dll")] static extern bool SetBrushOrgEx(IntPtr hdc, int x, int y, IntPtr previous);
    [DllImport("gdi32.dll")] static extern bool GdiFlush();

    const uint SRCCOPY = 0x00CC0020;
    const int HALFTONE = 4;
    const uint MONITORINFOF_PRIMARY = 1;
    // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2: monitor rectangles and BitBlt use physical pixels.
    static readonly IntPtr PerMonitorAwareV2 = new IntPtr(-4);

    static int Main(string[] args)
    {
        try
        {
            return Run(args);
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }

    static int Run(string[] args)
    {
        int width, height;
        if (args.Length < 2 || !int.TryParse(args[0], out width) || !int.TryParse(args[1], out height) ||
            width < 1 || height < 1 || width > 4096 || height > 4096)
        {
            Console.Error.WriteLine("Usage: gdi-capture.exe <width> <height> [<display id>]");
            return 2;
        }
        string wanted = args.Length > 2 ? DeviceKey(args[2]) : null;

        MakeDpiAware();
        Display display = FindDisplay(wanted);

        IntPtr screen = GetDC(IntPtr.Zero);
        IntPtr fullDc = CreateCompatibleDC(screen);
        IntPtr smallDc = CreateCompatibleDC(screen);
        IntPtr smallBits;
        IntPtr smallBitmap = CreateBitmap(smallDc, width, height, out smallBits);
        SelectObject(smallDc, smallBitmap);
        SetStretchBltMode(smallDc, HALFTONE);
        SetBrushOrgEx(smallDc, 0, 0, IntPtr.Zero);

        IntPtr fullBitmap = IntPtr.Zero;
        int fullWidth = 0, fullHeight = 0;
        byte[] frame = new byte[width * height * 4];
        Stream input = Console.OpenStandardInput();
        Stream output = Console.OpenStandardOutput();

        while (input.ReadByte() >= 0)
        {
            display = FindDisplay(wanted);
            int w = display.Bounds.Right - display.Bounds.Left;
            int h = display.Bounds.Bottom - display.Bounds.Top;
            if (w != fullWidth || h != fullHeight)
            {
                // First frame, or the display changed resolution: size the full-screen bitmap to match.
                if (fullBitmap != IntPtr.Zero) DeleteObject(fullBitmap);
                IntPtr unused;
                fullBitmap = CreateBitmap(fullDc, w, h, out unused);
                SelectObject(fullDc, fullBitmap);
                fullWidth = w;
                fullHeight = h;
            }

            // BitBlt fails while Windows shows the secure desktop (UAC prompt, lock screen). Then the previous
            // frame is sent again, so the light holds its color.
            if (BitBlt(fullDc, 0, 0, w, h, screen, display.Bounds.Left, display.Bounds.Top, SRCCOPY))
            {
                StretchBlt(smallDc, 0, 0, width, height, fullDc, 0, 0, w, h, SRCCOPY);
                GdiFlush();
                Marshal.Copy(smallBits, frame, 0, frame.Length);
            }
            output.Write(frame, 0, frame.Length);
            output.Flush();
        }

        DeleteObject(smallBitmap);
        if (fullBitmap != IntPtr.Zero) DeleteObject(fullBitmap);
        DeleteDC(smallDc);
        DeleteDC(fullDc);
        return 0;
    }

    static void MakeDpiAware()
    {
        try
        {
            if (SetProcessDpiAwarenessContext(PerMonitorAwareV2)) return;
        }
        catch (EntryPointNotFoundException)
        {
            // Windows before 10 (1703).
        }
        SetProcessDPIAware();
    }

    /** A 32-bit top-down DIB section selected into nothing yet. */
    static IntPtr CreateBitmap(IntPtr hdc, int width, int height, out IntPtr bits)
    {
        BitmapInfoHeader info = new BitmapInfoHeader();
        info.Size = Marshal.SizeOf(typeof(BitmapInfoHeader));
        info.Width = width;
        info.Height = -height;
        info.Planes = 1;
        info.BitCount = 32;
        IntPtr bitmap = CreateDIBSection(hdc, ref info, 0, out bits, IntPtr.Zero, 0);
        if (bitmap == IntPtr.Zero) throw new Exception("Could not create a " + width + "x" + height + " bitmap");
        return bitmap;
    }

    /** "\\.\DISPLAY2" and "DISPLAY2" both become "DISPLAY2". */
    static string DeviceKey(string id)
    {
        int slash = id.LastIndexOf('\\');
        return (slash >= 0 ? id.Substring(slash + 1) : id).ToUpperInvariant();
    }

    static Display FindDisplay(string wanted)
    {
        List<Display> displays = new List<Display>();
        MonitorEnumProc collect = delegate (IntPtr monitor, IntPtr hdc, IntPtr rect, IntPtr data)
        {
            MonitorInfoEx info = new MonitorInfoEx();
            info.Size = Marshal.SizeOf(typeof(MonitorInfoEx));
            if (GetMonitorInfo(monitor, ref info))
            {
                Display display = new Display();
                display.Device = info.Device;
                display.Bounds = info.Monitor;
                display.Primary = (info.Flags & MONITORINFOF_PRIMARY) != 0;
                displays.Add(display);
            }
            return true;
        };
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, collect, IntPtr.Zero);
        GC.KeepAlive(collect);

        foreach (Display display in displays)
        {
            if (wanted == null ? display.Primary : DeviceKey(display.Device) == wanted) return display;
        }
        List<string> names = new List<string>();
        foreach (Display display in displays) names.Add(display.Device);
        throw new Exception((wanted == null ? "No primary display found" : "No display " + wanted) +
            " (available: " + string.Join(", ", names.ToArray()) + ")");
    }
}
