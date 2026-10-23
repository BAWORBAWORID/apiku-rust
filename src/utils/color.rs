pub struct Color;

impl Color {
    pub fn black(text: &str) -> String { format!("\x1b[30m{}\x1b[39m", text) }
    pub fn red(text: &str) -> String { format!("\x1b[31m{}\x1b[39m", text) }
    pub fn green(text: &str) -> String { format!("\x1b[32m{}\x1b[39m", text) }
    pub fn yellow(text: &str) -> String { format!("\x1b[33m{}\x1b[39m", text) }
    pub fn blue(text: &str) -> String { format!("\x1b[34m{}\x1b[39m", text) }
    pub fn magenta(text: &str) -> String { format!("\x1b[35m{}\x1b[39m", text) }
    pub fn cyan(text: &str) -> String { format!("\x1b[36m{}\x1b[39m", text) }
    pub fn white(text: &str) -> String { format!("\x1b[37m{}\x1b[39m", text) }
    pub fn gray(text: &str) -> String { format!("\x1b[90m{}\x1b[39m", text) }

    pub fn bold(text: &str) -> String { format!("\x1b[1m{}\x1b[22m", text) }
    pub fn underline(text: &str) -> String { format!("\x1b[4m{}\x1b[24m", text) }
}
