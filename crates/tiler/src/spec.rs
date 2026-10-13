//! Descrição de como importar um dataset (o "mapeamento" escolhido no wizard).
//! Espelha `ImportMapping` de `@cityview/importer` + opções de leitura.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NumberLocale {
    /// "1.500,25": ponto é milhar, vírgula é decimal.
    Br,
    /// "1500.25" / "1,500.25".
    #[default]
    Intl,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ColumnKind {
    Number,
    Category,
    Date,
    Text,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnSpec {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: ColumnKind,
    #[serde(default)]
    pub locale: Option<NumberLocale>,
    /// Texto que também vai nos tiles de pontos (ex.: endereço, telefone). A coluna de título
    /// sempre vai; as demais de texto ficam só no arquivo de origem (detalhe pelo servidor).
    #[serde(default, rename = "inTiles")]
    pub in_tiles: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSpec {
    pub name: String,
    pub lat: String,
    pub lon: String,
    #[serde(default)]
    pub lat_locale: Option<NumberLocale>,
    #[serde(default)]
    pub lon_locale: Option<NumberLocale>,
    pub columns: Vec<ColumnSpec>,
    /// Coluna de categoria usada para cor e para as contagens dos hexágonos.
    #[serde(default)]
    pub color_by: Option<String>,
    /// Coluna mostrada como título no clique.
    #[serde(default)]
    pub title: Option<String>,
    /// Separador do CSV (padrão: vírgula).
    #[serde(default)]
    pub delimiter: Option<String>,
    /// "utf-8" (padrão) ou "windows-1252".
    #[serde(default)]
    pub encoding: Option<String>,
    /// Malhas para contar os registros por região (estado, município…), na ordem do mais amplo ao mais fino.
    #[serde(default)]
    pub regions: Vec<RegionSpec>,
}

/// Uma malha em GeoJSON: `id` do nível ("uf", "mun"), caminho do arquivo e a propriedade com o código.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegionSpec {
    pub id: String,
    pub path: String,
    #[serde(default = "default_code")]
    pub code: String,
}

fn default_code() -> String {
    "codigo".into()
}

impl ImportSpec {
    pub fn delimiter_byte(&self) -> u8 {
        match self.delimiter.as_deref() {
            Some("\t") | Some("tab") => b'\t',
            Some(d) if d.len() == 1 => d.as_bytes()[0],
            _ => b',',
        }
    }

    pub fn is_windows_1252(&self) -> bool {
        matches!(self.encoding.as_deref(), Some("windows-1252") | Some("latin1") | Some("iso-8859-1"))
    }
}
