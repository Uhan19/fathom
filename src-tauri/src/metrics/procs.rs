use super::memory::Machine;
#[cfg(any(target_os = "macos", target_os = "linux"))]
use super::memory::Process;

#[cfg(target_os = "macos")]
pub use mac::{args_of, machine};

#[cfg(target_os = "linux")]
pub use linux::{args_of, machine};

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn machine() -> Result<Machine, String> {
    Err("memory figures are only read on macOS and Linux".into())
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn args_of(_pid: u32) -> Vec<String> {
    vec![]
}

#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::{CStr, CString, c_char, c_int, c_void};
    use std::sync::OnceLock;

    use super::{Machine, Process};
    use crate::metrics::memory::Pressure;

    const SYSTEM_NAME: &str = "macOS";
    const LAUNCHD: u32 = 1;
    const RESPONSIBLE_SYMBOL: &CStr = c"responsibility_get_pid_responsible_for_pid";

    type Responsible = unsafe extern "C" fn(c_int) -> c_int;

    pub fn machine() -> Result<Machine, String> {
        let total = sysctl_u64("hw.memsize")?;
        let page = sysctl_u64("hw.pagesize")?;
        let vm = vm_statistics()?;
        let pages = |count: u32| u64::from(count) * page;
        let app = pages(vm.internal_page_count).saturating_sub(pages(vm.purgeable_count));
        let system = pages(vm.wire_count) + pages(vm.compressor_page_count);
        Ok(Machine {
            total,
            used: (app + system).min(total),
            system,
            system_name: SYSTEM_NAME,
            pressure: pressure(),
            activity_monitor: true,
            processes: processes(),
        })
    }

    fn sysctl_u64(name: &str) -> Result<u64, String> {
        let key = CString::new(name).map_err(|e| e.to_string())?;
        let mut value: u64 = 0;
        let mut size = std::mem::size_of::<u64>();
        let status = unsafe {
            libc::sysctlbyname(
                key.as_ptr(),
                (&mut value as *mut u64).cast(),
                &mut size,
                std::ptr::null_mut(),
                0,
            )
        };
        if status != 0 {
            return Err(format!("cannot read {name}"));
        }
        Ok(match size {
            4 => value & u64::from(u32::MAX),
            _ => value,
        })
    }

    fn pressure() -> Option<Pressure> {
        match sysctl_u64("kern.memorystatus_vm_pressure_level").ok()? {
            1 => Some(Pressure::Normal),
            2 => Some(Pressure::Warning),
            4 => Some(Pressure::Critical),
            _ => None,
        }
    }

    #[allow(deprecated)]
    fn vm_statistics() -> Result<libc::vm_statistics64, String> {
        let mut stats: libc::vm_statistics64 = unsafe { std::mem::zeroed() };
        let mut count = libc::HOST_VM_INFO64_COUNT;
        let status = unsafe {
            libc::host_statistics64(
                libc::mach_host_self(),
                libc::HOST_VM_INFO64,
                (&mut stats as *mut libc::vm_statistics64).cast(),
                &mut count,
            )
        };
        if status != libc::KERN_SUCCESS {
            return Err(format!("host_statistics64 failed with {status}"));
        }
        Ok(stats)
    }

    fn responsible() -> Option<Responsible> {
        static FOUND: OnceLock<Option<usize>> = OnceLock::new();
        let address = *FOUND.get_or_init(|| {
            let symbol = unsafe { libc::dlsym(libc::RTLD_DEFAULT, RESPONSIBLE_SYMBOL.as_ptr()) };
            (!symbol.is_null()).then_some(symbol as usize)
        });
        address.map(|a| unsafe { std::mem::transmute::<usize, Responsible>(a) })
    }

    fn pids() -> Vec<c_int> {
        let count = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
        if count <= 0 {
            return vec![];
        }
        let mut pids: Vec<c_int> = vec![0; count as usize * 2];
        let bytes = (pids.len() * std::mem::size_of::<c_int>()) as c_int;
        let filled = unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast(), bytes) };
        pids.truncate(filled.max(0) as usize);
        pids.retain(|pid| *pid > 0);
        pids
    }

    fn processes() -> Vec<Process> {
        let responsible = responsible();
        pids()
            .into_iter()
            .filter_map(|pid| process(pid, responsible))
            .collect()
    }

    fn process(pid: c_int, responsible: Option<Responsible>) -> Option<Process> {
        let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
        let size = std::mem::size_of::<libc::proc_bsdinfo>() as c_int;
        let read = unsafe {
            libc::proc_pidinfo(
                pid,
                libc::PROC_PIDTBSDINFO,
                0,
                (&mut info as *mut libc::proc_bsdinfo).cast(),
                size,
            )
        };
        if read != size {
            return None;
        }
        let mut parent = info.pbi_ppid;
        if parent == LAUNCHD
            && let Some(responsible) = responsible
        {
            let owner = unsafe { responsible(pid) };
            if owner > 0 && owner != pid {
                parent = owner as u32;
            }
        }
        Some(Process {
            pid: pid as u32,
            parent,
            name: c_text(&info.pbi_name)
                .filter(|n| !n.is_empty())
                .or_else(|| c_text(&info.pbi_comm))
                .unwrap_or_default(),
            path: path(pid),
            bytes: footprint(pid),
        })
    }

    fn c_text(chars: &[c_char]) -> Option<String> {
        let bytes: Vec<u8> = chars
            .iter()
            .take_while(|c| **c != 0)
            .map(|c| *c as u8)
            .collect();
        Some(String::from_utf8_lossy(&bytes).into_owned())
    }

    fn path(pid: c_int) -> String {
        let mut buffer = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
        let length =
            unsafe { libc::proc_pidpath(pid, buffer.as_mut_ptr().cast(), buffer.len() as u32) };
        if length <= 0 {
            return String::new();
        }
        String::from_utf8_lossy(&buffer[..length as usize]).into_owned()
    }

    fn footprint(pid: c_int) -> u64 {
        let mut usage: libc::rusage_info_v2 = unsafe { std::mem::zeroed() };
        let status = unsafe {
            libc::proc_pid_rusage(
                pid,
                libc::RUSAGE_INFO_V2,
                (&mut usage as *mut libc::rusage_info_v2).cast::<c_void>() as *mut _,
            )
        };
        if status == 0 {
            usage.ri_phys_footprint
        } else {
            0
        }
    }

    pub fn args_of(pid: u32) -> Vec<String> {
        let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid as c_int];
        let mut size: usize = 0;
        let sized = unsafe {
            libc::sysctl(
                mib.as_mut_ptr(),
                3,
                std::ptr::null_mut(),
                &mut size,
                std::ptr::null_mut(),
                0,
            )
        };
        if sized != 0 || size == 0 {
            return vec![];
        }
        let mut buffer = vec![0u8; size];
        let read = unsafe {
            libc::sysctl(
                mib.as_mut_ptr(),
                3,
                buffer.as_mut_ptr().cast(),
                &mut size,
                std::ptr::null_mut(),
                0,
            )
        };
        if read != 0 {
            return vec![];
        }
        parse_procargs(&buffer[..size])
    }

    pub(super) fn parse_procargs(buffer: &[u8]) -> Vec<String> {
        let Some(count) = buffer.get(..4) else {
            return vec![];
        };
        let argc = i32::from_ne_bytes(count.try_into().unwrap_or_default()).max(0) as usize;
        let rest = &buffer[4..];
        let Some(exec_end) = rest.iter().position(|b| *b == 0) else {
            return vec![];
        };
        rest[exec_end..]
            .split(|b| *b == 0)
            .filter(|part| !part.is_empty())
            .take(argc)
            .map(|part| String::from_utf8_lossy(part).into_owned())
            .collect()
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn procargs_skip_the_exec_path_and_its_padding() {
            let mut buffer = 2i32.to_ne_bytes().to_vec();
            buffer.extend_from_slice(b"/usr/bin/node\0\0\0\0node\0/x/vite.js\0HOME=/h\0");
            assert_eq!(parse_procargs(&buffer), ["node", "/x/vite.js"]);
            assert!(parse_procargs(b"\0").is_empty());
        }

        #[test]
        fn this_machine_reads_like_activity_monitor() {
            let machine = machine().unwrap();
            assert!(machine.used > 0 && machine.used <= machine.total);
            let own = std::process::id();
            let me = machine.processes.iter().find(|p| p.pid == own).unwrap();
            assert!(me.bytes > 0);
            assert!(!args_of(own).is_empty());
        }
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use super::{Machine, Process};

    const SYSTEM_NAME: &str = "System";
    const KIB: u64 = 1024;
    const KERNEL_FIELDS: [&str; 3] = ["SUnreclaim", "KernelStack", "PageTables"];

    pub fn machine() -> Result<Machine, String> {
        let meminfo = std::fs::read_to_string("/proc/meminfo")
            .map_err(|e| format!("cannot read /proc/meminfo: {e}"))?;
        let field = |name: &str| meminfo_field(&meminfo, name);
        let total = field("MemTotal").ok_or("/proc/meminfo has no MemTotal")?;
        let available = field("MemAvailable").ok_or("/proc/meminfo has no MemAvailable")?;
        let system = KERNEL_FIELDS.iter().filter_map(|name| field(name)).sum();
        Ok(Machine {
            total,
            used: total.saturating_sub(available),
            system,
            system_name: SYSTEM_NAME,
            pressure: None,
            activity_monitor: false,
            processes: processes(),
        })
    }

    pub(super) fn meminfo_field(meminfo: &str, name: &str) -> Option<u64> {
        meminfo
            .lines()
            .find_map(|line| {
                let (key, value) = line.split_once(':')?;
                (key == name).then(|| {
                    value
                        .trim()
                        .trim_end_matches(" kB")
                        .trim()
                        .parse::<u64>()
                        .ok()
                })?
            })
            .map(|kib| kib * KIB)
    }

    fn processes() -> Vec<Process> {
        let Ok(entries) = std::fs::read_dir("/proc") else {
            return vec![];
        };
        entries
            .flatten()
            .filter_map(|entry| entry.file_name().to_str()?.parse::<u32>().ok())
            .filter_map(process)
            .collect()
    }

    fn process(pid: u32) -> Option<Process> {
        let dir = format!("/proc/{pid}");
        let stat = std::fs::read_to_string(format!("{dir}/stat")).ok()?;
        let (name, parent) = parse_stat(&stat)?;
        let bytes = std::fs::read_to_string(format!("{dir}/smaps_rollup"))
            .ok()
            .and_then(|rollup| meminfo_field(&rollup, "Pss"))
            .unwrap_or(0);
        let path = std::fs::read_link(format!("{dir}/exe"))
            .map(|p| p.display().to_string())
            .unwrap_or_default();
        Some(Process {
            pid,
            parent,
            name,
            path,
            bytes,
        })
    }

    pub(super) fn parse_stat(stat: &str) -> Option<(String, u32)> {
        let open = stat.find('(')?;
        let close = stat.rfind(')')?;
        let name = stat.get(open + 1..close)?.to_string();
        let mut fields = stat.get(close + 1..)?.split_whitespace();
        let _state = fields.next()?;
        let parent = fields.next()?.parse().ok()?;
        Some((name, parent))
    }

    pub fn args_of(pid: u32) -> Vec<String> {
        std::fs::read(format!("/proc/{pid}/cmdline"))
            .map(|raw| {
                raw.split(|b| *b == 0)
                    .filter(|part| !part.is_empty())
                    .map(|part| String::from_utf8_lossy(part).into_owned())
                    .collect()
            })
            .unwrap_or_default()
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn stat_and_meminfo_fields_parse() {
            assert_eq!(
                parse_stat("42 (my (odd) name) S 7 42 42 0"),
                Some(("my (odd) name".into(), 7))
            );
            let meminfo = "MemTotal:       16384 kB\nMemAvailable:    4096 kB\n";
            assert_eq!(meminfo_field(meminfo, "MemAvailable"), Some(4096 * 1024));
            assert_eq!(meminfo_field(meminfo, "Pss"), None);
        }
    }
}
