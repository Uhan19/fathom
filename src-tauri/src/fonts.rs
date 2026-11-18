const HIDDEN_FAMILY_PREFIX: char = '.';

#[cfg(target_os = "macos")]
fn available_families() -> Vec<String> {
    use objc2_core_foundation::{CFArray, CFRetained, CFString};
    use objc2_core_text::CTFontManagerCopyAvailableFontFamilyNames;

    let names = unsafe { CTFontManagerCopyAvailableFontFamilyNames() };
    let names: CFRetained<CFArray<CFString>> = unsafe { CFRetained::cast_unchecked(names) };
    names.iter().map(|name| name.to_string()).collect()
}

#[cfg(target_os = "linux")]
fn available_families() -> Vec<String> {
    use fontconfig::{FC_FAMILY, Fontconfig, ObjectSet, Pattern, list_fonts};

    let Some(config) = Fontconfig::new() else {
        return Vec::new();
    };
    let listed = Pattern::new(&config).and_then(|pattern| {
        let mut objects = ObjectSet::new(&config)?;
        objects.add(FC_FAMILY)?;
        let fonts = list_fonts(&pattern, Some(&objects))?;
        Ok(fonts
            .iter()
            .filter_map(|font| font.get_string(FC_FAMILY).ok().map(str::to_string))
            .collect())
    });
    listed.unwrap_or_default()
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn available_families() -> Vec<String> {
    Vec::new()
}

pub fn installed_families() -> Vec<String> {
    visible_in_order(available_families())
}

fn visible_in_order(names: Vec<String>) -> Vec<String> {
    let mut families: Vec<String> = names
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

    fn assert_visible_and_ordered(families: &[String]) {
        assert!(
            families
                .iter()
                .all(|f| !f.starts_with(HIDDEN_FAMILY_PREFIX))
        );
        let lowered: Vec<String> = families.iter().map(|f| f.to_lowercase()).collect();
        assert!(lowered.windows(2).all(|pair| pair[0] <= pair[1]));
    }

    #[test]
    fn drops_hidden_and_blank_names_then_sorts_and_dedups() {
        let names = [" Menlo ", ".SF NS", "", "courier", "Menlo", "Avenir"]
            .map(str::to_string)
            .to_vec();
        assert_eq!(visible_in_order(names), ["Avenir", "courier", "Menlo"]);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn lists_visible_system_families_in_order() {
        let families = installed_families();
        assert!(families.iter().any(|f| f == "Menlo"));
        assert_visible_and_ordered(&families);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn lists_fontconfig_families_in_order() {
        let families = installed_families();
        assert!(families.iter().any(|f| f == "DejaVu Sans"));
        assert_visible_and_ordered(&families);
    }
}
