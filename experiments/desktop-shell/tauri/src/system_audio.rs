//! System audio on macOS: a Core Audio process tap (macOS 14.2+) read through a
//! private aggregate device. Each buffer goes to the page as base64 PCM through
//! `eval`, the same shape as the Android spike's transport.
use base64::Engine;
use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use std::ffi::{c_void, CString};
use std::io::Write;
use std::sync::mpsc::{channel, Sender};
use std::time::{SystemTime, UNIX_EPOCH};

#[repr(C)]
struct Address {
    selector: u32,
    scope: u32,
    element: u32,
}

#[repr(C)]
struct AudioBuffer {
    channels: u32,
    bytes: u32,
    data: *mut c_void,
}

#[repr(C)]
struct AudioBufferList {
    count: u32,
    buffers: [AudioBuffer; 1],
}

// Only the leading fields of AudioTimeStamp are read.
#[repr(C)]
struct AudioTimeStamp {
    _sample_time: f64,
    host_time: u64,
}

#[repr(C)]
struct StreamDescription {
    sample_rate: f64,
    _format_id: u32,
    _format_flags: u32,
    _bytes_per_packet: u32,
    _frames_per_packet: u32,
    _bytes_per_frame: u32,
    channels_per_frame: u32,
    _bits_per_channel: u32,
    _reserved: u32,
}

type IoProc = extern "C" fn(
    u32,
    *const AudioTimeStamp,
    *const AudioBufferList,
    *const AudioTimeStamp,
    *mut AudioBufferList,
    *const AudioTimeStamp,
    *mut c_void,
) -> i32;

#[link(name = "CoreAudio", kind = "framework")]
extern "C" {
    fn AudioHardwareCreateProcessTap(description: *mut AnyObject, out: *mut u32) -> i32;
    fn AudioHardwareCreateAggregateDevice(description: *const c_void, out: *mut u32) -> i32;
    fn AudioObjectGetPropertyData(
        object: u32,
        address: *const Address,
        qualifier_size: u32,
        qualifier: *const c_void,
        size: *mut u32,
        data: *mut c_void,
    ) -> i32;
    fn AudioDeviceCreateIOProcID(
        device: u32,
        proc_: IoProc,
        client: *mut c_void,
        out: *mut *mut c_void,
    ) -> i32;
    fn AudioDeviceStart(device: u32, proc_id: *mut c_void) -> i32;
    fn AudioGetCurrentHostTime() -> u64;
    fn AudioConvertHostTimeToNanos(host_time: u64) -> u64;
}

const fn fourcc(code: &[u8; 4]) -> u32 {
    u32::from_be_bytes(*code)
}
const SYSTEM_OBJECT: u32 = 1;
const SCOPE_GLOBAL: u32 = fourcc(b"glob");

unsafe fn ns_string(value: &str) -> *mut AnyObject {
    let value = CString::new(value).unwrap();
    msg_send![class!(NSString), stringWithUTF8String: value.as_ptr()]
}

unsafe fn ns_dictionary(pairs: &[(&str, *mut AnyObject)]) -> *mut AnyObject {
    let dictionary: *mut AnyObject = msg_send![class!(NSMutableDictionary), dictionary];
    for (key, value) in pairs {
        let _: () = msg_send![dictionary, setObject: *value, forKey: ns_string(key)];
    }
    dictionary
}

unsafe fn ns_array(items: &[*mut AnyObject]) -> *mut AnyObject {
    let array: *mut AnyObject = msg_send![class!(NSMutableArray), array];
    for item in items {
        let _: () = msg_send![array, addObject: *item];
    }
    array
}

unsafe fn ns_bool(value: bool) -> *mut AnyObject {
    msg_send![class!(NSNumber), numberWithBool: value]
}

unsafe fn property<T>(object: u32, selector: u32, value: *mut T) -> Result<(), String> {
    let address = Address { selector, scope: SCOPE_GLOBAL, element: 0 };
    let mut size = std::mem::size_of::<T>() as u32;
    let status = AudioObjectGetPropertyData(
        object,
        &address,
        0,
        std::ptr::null(),
        &mut size,
        value.cast(),
    );
    if status == 0 {
        Ok(())
    } else {
        Err(format!("property {selector:x} failed: {status}"))
    }
}

fn unix_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs_f64() * 1000.0
}

/// One device buffer on its way to the page.
struct Chunk {
    interleaved: Vec<f32>,
    input_at: f64,
    callback_at: f64,
    device_buffer_frames: usize,
}

extern "C" fn on_buffer(
    _device: u32,
    _now: *const AudioTimeStamp,
    input: *const AudioBufferList,
    input_time: *const AudioTimeStamp,
    _output: *mut AudioBufferList,
    _output_time: *const AudioTimeStamp,
    client: *mut c_void,
) -> i32 {
    unsafe {
        let sender = &*(client as *const Sender<Chunk>);
        let list = &*input;
        if list.count == 0 {
            return 0;
        }
        let buffers = std::slice::from_raw_parts(list.buffers.as_ptr(), list.count as usize);
        let first = &buffers[0];
        let mut interleaved = Vec::new();
        let frames;
        if list.count >= 2 {
            // Non-interleaved: one buffer per channel.
            frames = first.bytes as usize / 4;
            let left = std::slice::from_raw_parts(first.data as *const f32, frames);
            let right = std::slice::from_raw_parts(buffers[1].data as *const f32, frames);
            interleaved.reserve(frames * 2);
            for i in 0..frames {
                interleaved.push(left[i]);
                interleaved.push(right[i]);
            }
        } else {
            let channels = first.channels.max(1) as usize;
            frames = first.bytes as usize / 4 / channels;
            let samples = std::slice::from_raw_parts(first.data as *const f32, frames * channels);
            interleaved.reserve(frames * 2);
            for frame in samples.chunks(channels) {
                interleaved.push(frame[0]);
                interleaved.push(*frame.get(1).unwrap_or(&frame[0]));
            }
        }
        // Host times become wall-clock, the one clock the page shares with us.
        let callback_at = unix_ms();
        let host_now = AudioConvertHostTimeToNanos(AudioGetCurrentHostTime());
        let host_input = AudioConvertHostTimeToNanos((*input_time).host_time);
        let input_at = callback_at - (host_now as f64 - host_input as f64) / 1e6;
        let _ = sender.send(Chunk {
            interleaved,
            input_at,
            callback_at,
            device_buffer_frames: frames,
        });
    }
    0
}

/// Reads the tap through a private aggregate device on the default output.
unsafe fn open_device(tap_uid: *mut AnyObject, sender: Sender<Chunk>) -> Result<(), String> {
    let mut output = 0u32;
    property(SYSTEM_OBJECT, fourcc(b"sOut"), &mut output)?;
    let mut output_uid: *mut AnyObject = std::ptr::null_mut();
    property(output, fourcc(b"uid "), &mut output_uid)?;

    let device_uid: *mut AnyObject = {
        let id: *mut AnyObject = msg_send![class!(NSUUID), UUID];
        msg_send![id, UUIDString]
    };
    let aggregate = ns_dictionary(&[
        ("name", ns_string("Stims system audio")),
        ("uid", device_uid),
        ("master", output_uid),
        ("private", ns_bool(true)),
        ("stacked", ns_bool(false)),
        ("tapautostart", ns_bool(true)),
        ("subdevices", ns_array(&[ns_dictionary(&[("uid", output_uid)])])),
        (
            "taps",
            ns_array(&[ns_dictionary(&[("uid", tap_uid), ("drift", ns_bool(true))])]),
        ),
    ]);
    let mut device = 0u32;
    let status = AudioHardwareCreateAggregateDevice(aggregate.cast(), &mut device);
    if status != 0 {
        return Err(format!("AudioHardwareCreateAggregateDevice failed: {status}"));
    }

    // Lives as long as the process, like the IOProc that reads it.
    let client = Box::into_raw(Box::new(sender));
    let mut proc_id: *mut c_void = std::ptr::null_mut();
    let status = AudioDeviceCreateIOProcID(device, on_buffer, client.cast(), &mut proc_id);
    if status != 0 {
        return Err(format!("AudioDeviceCreateIOProcID failed: {status}"));
    }
    let status = AudioDeviceStart(device, proc_id);
    if status != 0 {
        return Err(format!("AudioDeviceStart failed: {status}"));
    }
    Ok(())
}

/// Starts the tap and hands base64 PCM to `push(nativeAtMs, base64)` from a
/// worker thread. Returns the tap's sample rate. The first run triggers the
/// macOS system-audio prompt; until it is answered no audio arrives.
pub fn start(push: impl Fn(f64, String) + Send + 'static) -> Result<f64, String> {
    let (sender, receiver) = channel::<Chunk>();
    let log_path = std::env::var("STIMS_SPIKE_NATIVE_LOG").ok();

    let rate = unsafe {
        let description: *mut AnyObject = msg_send![class!(CATapDescription), alloc];
        let description: *mut AnyObject =
            msg_send![description, initStereoGlobalTapButExcludeProcesses: ns_array(&[])];
        let _: () = msg_send![description, setPrivate: true];
        let uuid: *mut AnyObject = msg_send![description, UUID];
        let tap_uid: *mut AnyObject = msg_send![uuid, UUIDString];
        // Crosses to the device thread, past this pool's lifetime.
        let tap_uid: *mut AnyObject = msg_send![tap_uid, retain];

        let mut tap = 0u32;
        let status = AudioHardwareCreateProcessTap(description, &mut tap);
        if status != 0 {
            return Err(format!("AudioHardwareCreateProcessTap failed: {status}"));
        }

        // The tap's own format reports 48 kHz even when it delivers at the output
        // device's rate (measured: 44.1 kHz at 512 frames, 86 buffers a second).
        // Trusting it starves the page's context and shifts the pitch by 9%.
        let mut output = 0u32;
        property(SYSTEM_OBJECT, fourcc(b"sOut"), &mut output)?;
        let mut rate = 0f64;
        property(output, fourcc(b"nsrt"), &mut rate)?;
        let mut format: StreamDescription = std::mem::zeroed();
        property(tap, fourcc(b"tfmt"), &mut format)?;
        eprintln!(
            "output {rate} Hz; tap reports {} Hz, {} channels",
            format.sample_rate, format.channels_per_frame,
        );

        // Creating the IOProc blocks until the first-run system-audio prompt is
        // answered, so none of this can run on the thread that draws the window.
        let tap_uid = tap_uid as usize;
        std::thread::spawn(move || {
            if let Err(error) = open_device(tap_uid as *mut AnyObject, sender) {
                eprintln!("system audio failed: {error}");
            }
        });
        rate
    };

    std::thread::spawn(move || {
        let mut log = log_path.and_then(|path| std::fs::File::create(path).ok());
        let mut last_loud_at = 0.0f64;
        for chunk in receiver {
            let mut peak = 0.0f32;
            let mut pcm = Vec::with_capacity(chunk.interleaved.len() * 2);
            for sample in &chunk.interleaved {
                peak = peak.max(sample.abs());
                let scaled = (sample.clamp(-1.0, 1.0) * 32767.0) as i16;
                pcm.extend_from_slice(&scaled.to_le_bytes());
            }
            if peak >= 0.004 {
                if chunk.callback_at - last_loud_at > 150.0 {
                    if let Some(file) = log.as_mut() {
                        let _ = writeln!(
                            file,
                            "{{\"kind\":\"native\",\"inputAt\":{},\"callbackAt\":{},\"peak\":{},\"frames\":{}}}",
                            chunk.input_at, chunk.callback_at, peak, chunk.device_buffer_frames
                        );
                    }
                }
                last_loud_at = chunk.callback_at;
            }
            push(
                chunk.callback_at,
                base64::engine::general_purpose::STANDARD.encode(&pcm),
            );
        }
    });
    Ok(rate)
}
