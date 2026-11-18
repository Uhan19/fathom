const HIDDEN_FAMILY_PREFIX: char = '.';

#[cfg(target_os = "macos")]
fn available_families() -> Vec<String> {
    use objc2_core_foundation::{CFArray, CFRetained, CFString};
    use objc2_core_text::CTFontManagerCopyAvailableFontFamilyNames;

    let names = unsafe { CTFontManagerCopyAvailableFontFamilyNames() };
    let names: CFRetained<CFArray<CFString>> = unsafe { CFRetained::cast_unchecked(names) };
    names.iter().map(|name| name.to_string()).collect()
}

#[cfg(not(target_os = "macos"))]
fn available_families() -> Vec<String> {
    Vec::new()
}

pub fn installed_families() -> Vec<String> {
    let mut families: Vec<String> = available_families()
        .into_iter()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty() && !name.starts_with(HIDDEN_FAMILY_PREFIX))
        .collect();
    families.sort_by_key(|name| name.to_lowercase());
    families.dedup();
    families
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn lists_visible_system_families_in_order() {
        let families = installed_families();
        assert!(families.iter().any(|f| f == "Menlo"));
        assert!(
            families
                .iter()
                .all(|f| !f.starts_with(HIDDEN_FAMILY_PREFIX))
        );
        let lowered: Vec<String> = families.iter().map(|f| f.to_lowercase()).collect();
        assert!(lowered.windows(2).all(|pair| pair[0] <= pair[1]));
    }
}
