using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

class Tracker : Form {
  readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 20000000, RecursionLimit = 100 };
  readonly string basePath = AppDomain.CurrentDomain.BaseDirectory;
  readonly string dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ApexMonsterTracker");
  string dataPath; WebView2 browser;
  static readonly string[] collections = {"sales", "restocks", "refmoves", "money", "oct_batches"};
  Tracker() {
    Text = "APEX Monster Sales Tracker"; Width = 1200; Height = 850; MinimumSize = new System.Drawing.Size(600, 500);
    dataPath = Path.Combine(dataDir, "data.json");
    browser = new WebView2 { Dock = DockStyle.Fill }; Controls.Add(browser);
    Shown += async (sender, args) => {
      try {
        Directory.CreateDirectory(dataDir);
        if (!File.Exists(dataPath)) { string seed=File.ReadAllText(Path.Combine(basePath,"snapshot.json"), Encoding.UTF8); Validate(seed); SaveData(seed); }
        else Validate(File.ReadAllText(dataPath,Encoding.UTF8));
        var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(dataDir, "Browser"));
        await browser.EnsureCoreWebView2Async(env);
        browser.CoreWebView2.Settings.AreDevToolsEnabled = false;
        browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        browser.CoreWebView2.Settings.IsStatusBarEnabled = false;
        browser.CoreWebView2.SetVirtualHostNameToFolderMapping("monster.local", basePath, CoreWebView2HostResourceAccessKind.DenyCors);
        browser.CoreWebView2.NavigationStarting += (s,e) => { if (!e.Uri.StartsWith("https://monster.local/", StringComparison.OrdinalIgnoreCase)) e.Cancel=true; };
        browser.CoreWebView2.NewWindowRequested += (s,e) => {e.Handled=true;};
        browser.CoreWebView2.WebMessageReceived += Message;
        browser.Source = new Uri("https://monster.local/index.html");
      } catch(Exception ex) {
        MessageBox.Show("The tracker could not start. Your existing data was not reset.\n\n"+ex.Message+"\n\nThis app requires Microsoft Edge WebView2 Runtime and .NET Framework 4.7.2 or later.", "Startup error", MessageBoxButtons.OK, MessageBoxIcon.Error); Close();
      }
    };
  }
  void Validate(string text) {
    var d = json.DeserializeObject(text) as Dictionary<string,object>;
    if (d == null) throw new Exception("Invalid backup format.");
    foreach (string name in collections) {
      var list = d.ContainsKey(name) ? d[name] as object[] : null;
      if (list == null) throw new Exception("Missing or invalid collection: " + name);
      var ids = new HashSet<string>();
      foreach (object entry in list) {
        var rec = entry as Dictionary<string,object>;
        if (rec == null || !rec.ContainsKey("id") || !(rec["id"] is string) || String.IsNullOrWhiteSpace((string)rec["id"]) || !ids.Add((string)rec["id"])) throw new Exception("Invalid or duplicate record ID in " + name);
      }
    }
    foreach (string name in new[]{"settings/main", "oct/config"}) if (!d.ContainsKey(name) || !(d[name] is Dictionary<string,object>)) throw new Exception("Missing or invalid document: " + name);
  }
  void SaveData(string content) {
    Validate(content); Directory.CreateDirectory(dataDir); string tmp = dataPath + ".tmp";
    File.WriteAllText(tmp, content, new UTF8Encoding(false));
    if (File.Exists(dataPath)) File.Replace(tmp, dataPath, dataPath + ".previous", true); else File.Move(tmp, dataPath);
  }
  void Message(object sender, CoreWebView2WebMessageReceivedEventArgs e) {
    object id = null;
    try {
      var req=json.DeserializeObject(e.WebMessageAsJson) as Dictionary<string,object>; id=req["id"]; string op=(string)req["op"]; object val=null;
      switch(op) {
        case "read": val=json.DeserializeObject(File.ReadAllText(dataPath,Encoding.UTF8)); break;
        case "write": SaveData(json.Serialize(req["value"])); break;
        case "backup":
          using(var dlg = new SaveFileDialog {Title="Back up all tracker data", Filter="JSON backup (*.json)|*.json", FileName="monster-backup-"+DateTime.Now.ToString("yyyy-MM-dd")+".json", DefaultExt="json"}) {
            if(dlg.ShowDialog(this)==DialogResult.OK) { if (Path.GetFullPath(dlg.FileName).Equals(Path.GetFullPath(dataPath),StringComparison.OrdinalIgnoreCase)) throw new Exception("Choose a different backup file location."); File.Copy(dataPath,dlg.FileName,true); val=true; } else val=false;
          } break;
        case "restore":
          using(var dlg = new OpenFileDialog {Title="Choose tracker backup to restore", Filter="JSON backup (*.json)|*.json", CheckFileExists=true}) {
            if(dlg.ShowDialog(this)==DialogResult.OK && MessageBox.Show(this,"Replace the current local records with this backup? This cannot be undone in the app. Make a backup first.","Confirm restore",MessageBoxButtons.YesNo,MessageBoxIcon.Warning)==DialogResult.Yes) {
              string txt=File.ReadAllText(dlg.FileName,Encoding.UTF8); Validate(txt); SaveData(txt); val=json.DeserializeObject(txt);
            } else val=null;
          } break;
        case "csv":
          var csv=(Dictionary<string,object>)req["value"];
          using(var dlg = new SaveFileDialog {Title="Export sales CSV",Filter="CSV file (*.csv)|*.csv",FileName="monster-sales.csv",DefaultExt="csv"}) {
            if(dlg.ShowDialog(this)==DialogResult.OK) {File.WriteAllText(dlg.FileName,(string)csv["data"],new UTF8Encoding(true)); val=true;} else val=false;
          } break;
        default: throw new Exception("Unknown operation.");
      }
      browser.CoreWebView2.PostWebMessageAsJson(json.Serialize(new {id=id,value=val}));
    } catch(Exception ex) { browser.CoreWebView2.PostWebMessageAsJson(json.Serialize(new {id=id,error=ex.Message})); }
  }
  [STAThread] static void Main() {
    bool created; using(var mutex=new Mutex(true,@"Local\ApexMonsterSalesTracker",out created)) {
      if (!created) {MessageBox.Show("The tracker is already open. Use the existing window.","APEX Monster Sales Tracker");return;}
      Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false); Application.Run(new Tracker());
    }
  }
}
